"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY, LABELS, PORTFOLIO_IDS, usePortfolios, type PortfolioId } from "@/lib/portfolios";
import { ScrollEngine } from "@/lib/ScrollEngine";
import { useViewport } from "@/lib/useViewport";
import Menu from "./Menu";
import Gallery from "./Gallery";
import ProjectModal, { type ActiveProject } from "./project/ProjectModal";
import ProjectStrip from "./project/ProjectStrip";
import InfoModal, { type InfoKind } from "./InfoModal";
import PsychedelicFX from "./PsychedelicFX";
import AgentIntro from "./AgentIntro";
import Cursor from "./Cursor";

const DRAG_MULTIPLIER = 1.6;
const FLING_MULTIPLIER = 14;
// Slide-reveal timing (ms), shared by the intro and portfolio switches.
const SLIDE_HOLD = 1100;
const SLIDE_DUR = 620;
// Cap on how long a switch waits for the new portfolio's images before sliding
// in anyway (so a slow/failed image can't strand the panel off-screen).
const SWITCH_LOAD_CAP = 2500;
// How long the open-project close transition (gallery shrink + modal fade)
// takes to visually settle. The portfolio-switch slide-out below assumes the
// gallery is already at its closed (75%-width) size — sliding it off-screen
// while it's still full-screen undershoots, leaving a sliver of it hanging
// over the hero-logo reveal. Switching from an open project waits this long
// before starting the switch, so it starts from an already-closed gallery.
const PROJECT_CLOSE_MS = 500;
// Landing fade-out (must match the transition duration in AgentIntro). The
// gallery intro only starts once this has finished.
const SPLASH_FADE = 400;
// How long after the teaser reaches full screen the bottom teaser strip comes
// up: past the project sheet's own fade-in (ProjectModal waits 340ms, then
// fades over 320ms) plus a beat, so opening a project reads as the project
// first and the way onward second.
const STRIP_DELAY_MS = 1200;

/** Resolves once the image is loaded (or errored) — used to warm the cache. */
function preloadImage(url: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export default function PortfolioApp() {
  const viewport = useViewport();
  const portfolios = usePortfolios();
  const [portfolio, setPortfolio] = useState<PortfolioId>("interactive");
  const [opened, setOpened] = useState(false);
  // True only once the teaser has finished growing to full screen; gates the
  // project sheet's reveal.
  const [expandDone, setExpandDone] = useState(false);
  // The bottom teaser strip, held back until STRIP_DELAY_MS after expandDone.
  const [stripUp, setStripUp] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [intro, setIntro] = useState(false);
  // Slide-reveal intro: the menu/gallery panel starts pushed off by the canvas
  // size (menu parked at the window edge), a hero logo sits centered in the
  // exposed empty area, then the panel slides home.
  const [slideIn, setSlideIn] = useState(false);
  const [introLogo, setIntroLogo] = useState(true);
  // Splash gate: a full-page white overlay asks which portfolio to open in.
  // `started` flips once the choice has been made and the splash has faded,
  // which is what releases the gallery intro below.
  const [started, setStarted] = useState(false);
  const [splashHiding, setSplashHiding] = useState(false);
  // Resumé / Contact popup + the halftone trigger (hovering those buttons or
  // having their modal open).
  const [infoModal, setInfoModal] = useState<InfoKind | null>(null);
  const [infoHover, setInfoHover] = useState(false);
  // The gallery's WebGL canvas, sampled by the post-process distortion.
  const [galleryCanvas, setGalleryCanvas] = useState<HTMLCanvasElement | null>(null);
  const introFired = useRef(false);
  const openedRef = useRef(false);
  // True while a Resumé/Contact modal is open, so the global wheel/drag scroll
  // stands down and the modal can scroll natively.
  const infoOpenRef = useRef(false);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const switchTimer2 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeThenSwitchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // True until the splash is dismissed, so window-level scroll/drag and the
  // hover tooltip stand down while the gate is up.
  const splashOpenRef = useRef(true);
  const switchingRef = useRef(false);
  // Touch devices fire mouseenter (but not mouseleave) on tap, which would
  // latch the hover effect on. So on touch, ignore hover entirely — the
  // psychedelic effect only shows while a modal is open.
  const isTouch = useMemo(
    () =>
      typeof window !== "undefined" &&
      ((navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window),
    []
  );
  const engineRef = useRef<ScrollEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ScrollEngine();
  const engine = engineRef.current;
  const galleryRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Shared, mutable open/close progress (0=closed, 1=open). The layout effect
  // eases it each frame and resizes the canvas DOM; the WebGL scene reads the
  // same value, so plane dims, zoom and gap animate together.
  const animRef = useRef({ t: 0, w: 0, h: 0, animating: false });
  const anim = animRef.current;

  const items = portfolios ? portfolios[portfolio].items : [];
  // Mirror into refs so the open handler stays stable (items is a fresh array
  // each render — depending on it directly would re-subscribe the window
  // listeners every render and drop in-progress pointer state).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;
  // Hover tooltip ("View … Project") element, driven imperatively so mouse
  // tracking never re-renders React.
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Published by the tooltip effect below so the gallery can ask for a repaint
  // when the item under a stationary cursor changes.
  const repaintTip = useRef<(() => void) | null>(null);

  // Switch the portfolio by replaying the slide intro: slide the panel out to
  // the parked (pre-intro) state — exposing the logo-bg — swap the portfolio
  // off-screen, then slide it back in. Orientation-aware via `slideTransform`.
  const selectPortfolio = useCallback(
    (id: PortfolioId) => {
      if (openedRef.current || id === portfolio || switchingRef.current) return;
      switchingRef.current = true;
      setSwitching(true); // dim the list so its swap isn't seen at the edge
      setIntroLogo(true); // re-expose the logo-bg in the cleared area
      setSlideIn(false); // slide out to the parked state
      clearTimeout(switchTimer.current);
      clearTimeout(switchTimer2.current);
      switchTimer.current = setTimeout(() => {
        setPortfolio(id);
        engine.reset();
        // Only slide back in once the new portfolio's images are loaded, so the
        // full display never reveals a half-loaded gallery. A two-frame wait
        // lets the gallery apply the (now warm-cached) textures first.
        let slid = false;
        const slideHome = () => {
          if (slid) return;
          slid = true;
          clearTimeout(switchTimer2.current);
          setSlideIn(true);
          setSwitching(false);
          switchTimer2.current = setTimeout(() => {
            setIntroLogo(false);
            switchingRef.current = false;
          }, SLIDE_DUR);
        };
        const urls = portfolios ? portfolios[id].items.map((it) => it.image) : [];
        void Promise.all(urls.map(preloadImage)).then(() =>
          requestAnimationFrame(() => requestAnimationFrame(slideHome))
        );
        switchTimer2.current = setTimeout(slideHome, SWITCH_LOAD_CAP);
      }, SLIDE_DUR);
    },
    [engine, portfolio, portfolios]
  );

  useEffect(
    () => () => {
      clearTimeout(switchTimer.current);
      clearTimeout(switchTimer2.current);
      clearTimeout(closeThenSwitchTimer.current);
      clearTimeout(splashTimer.current);
    },
    []
  );

  // Splash choice: set the portfolio the gallery will open in, fade the
  // overlay out, and only then release the intro (which holds on the hero
  // logo before sliding the gallery home).
  const chooseStart = useCallback(
    (id: PortfolioId) => {
      if (splashHiding) return;
      setPortfolio(id);
      engine.reset();
      splashOpenRef.current = false;
      setSplashHiding(true);
      clearTimeout(splashTimer.current);
      splashTimer.current = setTimeout(() => setStarted(true), SPLASH_FADE);
    },
    [engine, splashHiding]
  );

  const selectItem = useCallback(
    (index: number) => {
      if (openedRef.current) return;
      engine.scrollToIndex(index);
    },
    [engine]
  );

  // Menu chevrons: move one teaser without any wheel/drag input.
  const stepItem = useCallback(
    (delta: number) => {
      if (openedRef.current) return;
      engine.stepItems(delta);
    },
    [engine]
  );

  const openProject = useCallback(() => {
    const item = itemsRef.current[engine.activeIndex];
    if (!item) return;
    setActiveProject({
      slug: item.slug,
      title: item.title,
      category: CATEGORY[portfolioRef.current],
    });
    openedRef.current = true;
    setOpened(true);
  }, [engine]);

  const closeProject = useCallback(() => {
    openedRef.current = false;
    setOpened(false);
  }, []);

  // Portfolio pills in the open-project nav: close the project back to the
  // gallery, then — once that close has visually settled — replay the normal
  // portfolio-switch slide. See PROJECT_CLOSE_MS for why this waits.
  const switchPortfolioFromProject = useCallback(
    (id: PortfolioId) => {
      closeProject();
      clearTimeout(closeThenSwitchTimer.current);
      closeThenSwitchTimer.current = setTimeout(() => selectPortfolio(id), PROJECT_CLOSE_MS);
    },
    [closeProject, selectPortfolio]
  );

  // Go to another project in the open project's portfolio. The modal fades
  // out on the project change while the engine slides the full-screen teaser
  // behind it to the new item, then the content fades in. Used by prev/next
  // and by the teaser strip along the bottom.
  const goToProject = useCallback(
    (index: number) => {
      const item = itemsRef.current[index];
      const cur = activeProjectRef.current;
      if (!item || !cur || item.slug === cur.slug) return;
      setActiveProject({
        slug: item.slug,
        title: item.title,
        category: CATEGORY[portfolioRef.current],
      });
      engine.scrollToIndex(index);
    },
    [engine]
  );

  // Prev/next (wraps at the ends).
  const navigateProject = useCallback(
    (dir: 1 | -1) => {
      const list = itemsRef.current;
      const cur = activeProjectRef.current;
      if (!cur || list.length < 2) return;
      const idx = list.findIndex((it) => it.slug === cur.slug);
      goToProject(((idx < 0 ? 0 : idx) + dir + list.length) % list.length);
    },
    [goToProject]
  );

  const openInfo = useCallback((kind: InfoKind) => {
    infoOpenRef.current = true;
    setInfoModal(kind);
  }, []);
  const closeInfo = useCallback(() => {
    infoOpenRef.current = false;
    setInfoModal(null);
  }, []);

  // Scroll driven by vertical wheel/drag on the entire window. A small
  // movement threshold (4px) ensures taps and menu clicks fire normally —
  // drag mode only engages once the pointer has actually moved. A clean tap
  // on the gallery (no drag) opens the active project; scrolling is suppressed
  // while a project is open.
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let flingVelocity = 0;
    let active = false; // pointer is down
    let dragging = false; // threshold crossed — suppress clicks
    let axis: "x" | "y" = "y"; // locked drag axis (horizontal is touch-only)
    let downOnGallery = false;

    const THRESHOLD = 4;

    const onWheel = (e: WheelEvent) => {
      if (openedRef.current || infoOpenRef.current || splashOpenRef.current) return;
      e.preventDefault();
      const delta =
        e.deltaMode === 1 ? e.deltaY * 16
        : e.deltaMode === 2 ? e.deltaY * window.innerHeight
        : e.deltaY;
      engine.input(delta);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (openedRef.current || infoOpenRef.current || splashOpenRef.current) return;
      active = true;
      dragging = false;
      axis = "y";
      downOnGallery =
        !!galleryRef.current && galleryRef.current.contains(e.target as Node);
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = performance.now();
      flingVelocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      if (!dragging) {
        const totalX = e.clientX - startX;
        const totalY = e.clientY - startY;
        // Vertical engages for any input; horizontal only on touch devices.
        const crossedY = Math.abs(totalY) > THRESHOLD;
        const crossedX = isTouch && Math.abs(totalX) > THRESHOLD;
        if (!crossedX && !crossedY) return;
        dragging = true;
        // Lock to the dominant axis on touch; non-touch is always vertical.
        axis = isTouch && Math.abs(totalX) > Math.abs(totalY) ? "x" : "y";
        engine.setInputHeld(true);
        document.body.style.cursor = "grabbing";
        document.body.classList.add("cursor-drag");
      }
      // Drag up (y) or swipe left (x) advances; the strip follows the finger.
      const d = axis === "x" ? lastX - e.clientX : lastY - e.clientY;
      engine.target += d * DRAG_MULTIPLIER;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      flingVelocity = (d / dt) * 16.7;
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = now;
    };

    const finish = (allowOpen: boolean) => {
      if (!active) return;
      active = false;
      if (dragging) {
        dragging = false;
        // Land in one motion, carrying the fling's momentum.
        engine.release(flingVelocity * FLING_MULTIPLIER);
        document.body.style.cursor = "";
        document.body.classList.remove("cursor-drag");
      } else if (allowOpen && downOnGallery && !openedRef.current) {
        openProject();
      }
    };
    const onPointerUp = () => finish(true);
    const onPointerCancel = () => finish(false);

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.body.style.cursor = "";
      document.body.classList.remove("cursor-drag");
    };
  }, [engine, openProject, isTouch]);

  const ready = !!viewport && !!portfolios;

  // Cursor-following "View … Project" tooltip over the gallery teasers.
  // Non-touch only; hidden while dragging, while a project or info modal is
  // open, and during portfolio switches. Driven imperatively (no re-renders).
  //
  // The label has to refresh without a pointermove: scrolling changes which
  // teaser sits under a stationary cursor, and a move-only update left the
  // tooltip naming the previous project until the mouse happened to twitch.
  // That used to be a permanent rAF; it's now driven by the gallery's
  // index-change callback (published into `repaintTip`), so a parked cursor
  // costs nothing and the main thread isn't woken 60 times a second for it.
  //
  // Depends on `ready`: the component returns null (no DOM at all, including
  // the tooltip div) until viewport + portfolios load, so this effect must
  // re-run once that flips true — otherwise it captures a null ref from a
  // loading-phase render and never attaches its listeners.
  useEffect(() => {
    if (isTouch || !ready) return;
    const tip = tooltipRef.current;
    if (!tip) return;
    let down = false;
    let overGallery = false;

    // The pill shows beside the custom cursor, which swells into its teaser
    // state while it does.
    const hide = () => {
      tip.style.opacity = "0";
      document.body.classList.remove("cursor-teaser");
    };
    // Everything that suppresses the tooltip, checked fresh each frame.
    const suppressed = () =>
      down ||
      !overGallery ||
      openedRef.current ||
      infoOpenRef.current ||
      splashOpenRef.current ||
      switchingRef.current;

    const paint = () => {
      if (suppressed()) {
        hide();
        return;
      }
      const item = itemsRef.current[engine.activeIndex];
      if (!item) {
        hide();
        return;
      }
      // Compare the rendered string, so this also catches a portfolio swap
      // that happens to land on the same index.
      const label = `View ${item.title} Project`;
      if (tip.textContent !== label) tip.textContent = label;
      tip.style.opacity = "1";
      document.body.classList.add("cursor-teaser");
    };

    repaintTip.current = paint;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      overGallery =
        !!galleryRef.current && galleryRef.current.contains(e.target as Node);
      // Position is the cursor's job (it rides beside the trailing ring).
      paint();
    };
    const onDown = () => {
      down = true;
      hide();
    };
    const onUp = () => {
      down = false;
    };
    const onLeave = () => {
      overGallery = false;
      hide();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    paint();
    return () => {
      repaintTip.current = null;
      document.body.classList.remove("cursor-teaser");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [engine, isTouch, ready]);

  // Fire the intro once — after the splash has been dismissed and both
  // viewport and portfolios are ready. Content fades in immediately (parked
  // at the edge beside the hero logo); after a hold the panel slides home,
  // then the hero logo is removed.
  useEffect(() => {
    if (!ready || !started || introFired.current) return;
    introFired.current = true;
    const t0 = setTimeout(() => setIntro(true), 60);
    const t1 = setTimeout(() => setSlideIn(true), SLIDE_HOLD);
    const t2 = setTimeout(() => setIntroLogo(false), SLIDE_HOLD + SLIDE_DUR);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // `started` must be here: it flips long after `ready` does, and without it
    // this effect never re-runs, so the reveal never fires.
  }, [ready, started]);

  // Animate open/close every frame: resize the canvas DOM and slide the menu
  // imperatively, easing the shared `anim.t`. Resizing the canvas per frame
  // forces R3F to re-measure each frame, so the plane dimensions (and camera
  // frustum) animate smoothly instead of jumping when the observer catches up.
  useLayoutEffect(() => {
    if (!viewport) return;
    const { width, height, isLandscape } = viewport;
    const closed = isLandscape
      ? { left: width * 0.25, top: 0, width: width * 0.75, height }
      : { left: 0, top: 0, width, height: height * 0.6 };
    const open = { left: 0, top: 0, width, height };
    const target = opened ? 1 : 0;
    const mix = (a: number, b: number, e: number) => a + (b - a) * e;

    const apply = (e: number) => {
      const w = mix(closed.width, open.width, e);
      const h = mix(closed.height, open.height, e);
      const g = galleryRef.current;
      if (g) {
        g.style.left = `${mix(closed.left, open.left, e)}px`;
        g.style.top = `${mix(closed.top, open.top, e)}px`;
        g.style.width = `${w}px`;
        g.style.height = `${h}px`;
      }
      const m = menuRef.current;
      if (m) {
        m.style.transform = isLandscape
          ? `translateX(${-e * 100}%)`
          : `translateY(${e * 100}%)`;
      }
      // Publish the live size so the WebGL scene scales its planes to match.
      anim.w = w;
      anim.h = h;
    };

    // The sheet waits on this rather than on a timer, so the content never
    // appears over a teaser still growing behind it — the ease is frame-based,
    // so its real duration moves with the refresh rate and with any change to
    // the easing constant.
    const settle = () => {
      anim.animating = false;
      setExpandDone(target === 1);
    };

    let raf = 0;
    const tick = () => {
      anim.t += (target - anim.t) * 0.17;
      if (Math.abs(target - anim.t) < 0.001) anim.t = target;
      apply(anim.t);
      if (anim.t !== target) {
        raf = requestAnimationFrame(tick);
      } else {
        settle();
      }
    };
    apply(anim.t); // sync immediately (first mount + resize-while-open)
    if (anim.t !== target) {
      anim.animating = true;
      setExpandDone(false);
      raf = requestAnimationFrame(tick);
    } else {
      settle();
    }
    return () => cancelAnimationFrame(raf);
    // `ready` is included so this re-runs once the gallery div is actually
    // rendered (the component returns null until data + viewport are ready),
    // otherwise the canvas would never get its imperative size.
  }, [opened, viewport, anim, ready]);

  // Only the first arrival waits: prev/next and the strip's own thumbs change
  // the project without touching `opened` or `expandDone`, so the strip stays
  // up while browsing. Closing drops it straight away.
  useEffect(() => {
    if (!opened || !expandDone) {
      setStripUp(false);
      return;
    }
    const t = setTimeout(() => setStripUp(true), STRIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [opened, expandDone]);

  if (!viewport || !portfolios) return null;

  const { width, height, isLandscape } = viewport;

  // Post-process shows while hovering the pills (non-touch only) or with a
  // modal open.
  const halftone = (!isTouch && infoHover) || infoModal !== null;

  // Menu docks in its corner; the layout effect slides it off via transform.
  const menuRect = isLandscape
    ? { left: 0, top: 0, width: width * 0.25, height }
    : { left: 0, top: height * 0.6, width, height: height * 0.4 };

  // Intro: push the whole panel off by the canvas size so the menu parks at the
  // window edge; the hero logo centers in the exposed (canvas-sized) gap.
  const slideTransform = slideIn
    ? "none"
    : isLandscape
      ? `translateX(${width * 0.75}px)`
      : `translateY(${-(height * 0.6)}px)`;
  const heroRect: React.CSSProperties = isLandscape
    ? { left: 0, top: 0, width: width * 0.75, height }
    : { left: 0, top: height * 0.4, width, height: height * 0.6 };

  return (
    <main
      className="relative w-full overflow-hidden bg-[#f8f8f8] text-white"
      style={{ height }}
    >
      {/* Hero logo centered in the exposed gap during the intro; the sliding
          panel (rendered after, so it paints on top) covers it on arrival. */}
      {introLogo && (
        <div
          aria-hidden
          className="pointer-events-none absolute bg-center bg-no-repeat"
          style={{
            ...heroRect,
            backgroundImage: "url(/logo-bg.svg)",
            backgroundSize: "cover",
          }}
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          transform: slideTransform,
          transition: `transform ${SLIDE_DUR}ms cubic-bezier(0.7, 0, 0.2, 1)`,
        }}
      >
        <div ref={menuRef} className="absolute" style={menuRect}>
          <Menu
            portfolio={portfolio}
            items={items}
            isLandscape={isLandscape}
            viewport={viewport}
            engine={engine}
            dimmed={switching}
            intro={intro}
            onSelectPortfolio={selectPortfolio}
            onSelectItem={selectItem}
            onStepItem={stepItem}
            onOpenInfo={openInfo}
            onInfoHover={setInfoHover}
          />
        </div>

        {/* Static gray backdrop stays put; only the canvas inside fades, so the
            crossfade passes through gray rather than flashing the dark page. */}
        <div
          ref={galleryRef}
          className="absolute touch-none overflow-hidden bg-[#f8f8f8]"
          style={{ opacity: intro ? 1 : 0, transition: "opacity 0.45s ease 60ms" }}
        >
          <div
            className="h-full w-full"
            style={{ opacity: switching ? 0 : 1, transition: "opacity 0.15s ease" }}
          >
            <Gallery
              items={items}
              portfolio={portfolio}
              isLandscape={isLandscape}
              engine={engine}
              opened={opened}
              anim={anim}
              // Dormant behind the splash and during a portfolio swap, so no
              // teaser video streams while the gallery is covered.
              visible={started && !switching}
              onIndexChange={() => repaintTip.current?.()}
              onReady={setGalleryCanvas}
            />
          </div>

          {/* Real WebGL post-process: samples the rendered gallery and warps it
              (swirl + domain-warp displacement + chromatic aberration +
              psychedelic recolor). Ramps in on Resumé/Contact hover or while
              their modal is open; only runs its shader loop while active. */}
          <PsychedelicFX active={halftone} source={galleryCanvas} />
        </div>
      </div>

      {/* Custom cursor, with the gallery's "View … Project" pill riding beside
          it (non-touch only). */}
      {!isTouch && <Cursor tooltipRef={tooltipRef} />}

      {/* Scrollable project content overlay — below the close button (z-50). */}
      <ProjectModal
        project={activeProject}
        opened={opened}
        expandDone={expandDone}
        height={height}
      />

      {/* Back + portfolio-switch nav — top-left. Inverted from the old close
          X: white buttons, black stroke, black text. The back arrow closes
          the project; the pills below switch portfolios (closing first). */}
      <div
        className="fixed left-5 top-5 z-50 flex flex-col items-start gap-2 transition-opacity duration-200"
        style={{
          opacity: opened ? 1 : 0,
          pointerEvents: opened ? "auto" : "none",
        }}
      >
        <button
          type="button"
          onClick={closeProject}
          aria-label="Back to gallery"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg ring-2 ring-inset ring-black transition-colors hover:!bg-black hover:!text-white hover:!ring-white"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        {PORTFOLIO_IDS.map((id) => {
          const active = id === portfolio;
          return (
            <button
              key={id}
              type="button"
              onClick={() => switchPortfolioFromProject(id)}
              aria-label={`Switch to ${LABELS[id]}`}
              className={`rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-2 ring-inset transition-colors ${
                active
                  ? "pointer-events-none bg-black text-white ring-white"
                  : "bg-white text-black ring-black hover:!bg-black hover:!text-white hover:!ring-white"
              }`}
            >
              {LABELS[id]}
            </button>
          );
        })}
      </div>

      {/* Prev/next project navigation — top-right. Previous points up, Next
          points down; each expands circle-to-pill on hover to reveal its
          label after the chevron, opening exactly as wide as the label — the
          label sits in a grid column that animates from 0fr to 1fr, which
          (unlike a width transition) tracks the text's real width, so the
          condensed face doesn't leave a tail of empty pill. Unlike the other
          nav buttons these don't invert color on hover — only the shape
          animates. */}
      <div
        className="fixed right-5 top-5 z-50 flex flex-col items-end gap-2 transition-opacity duration-300"
        style={{
          opacity: opened && items.length > 1 ? 1 : 0,
          pointerEvents: opened && items.length > 1 ? "auto" : "none",
        }}
      >
        {([
          { dir: -1, label: "Previous Project", points: "18 15 12 9 6 15" },
          { dir: 1, label: "Next Project", points: "6 9 12 15 18 9" },
        ] as const).map(({ dir, label, points }) => (
          <button
            key={dir}
            type="button"
            onClick={() => navigateProject(dir)}
            aria-label={label}
            className="group flex h-11 items-center overflow-hidden whitespace-nowrap rounded-full bg-white px-[13px] text-black shadow-lg ring-2 ring-inset ring-black"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#000000"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <polyline points={points} />
            </svg>
            <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]">
              <span className="overflow-hidden">
                <span className="block pl-2 text-[15px] font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                  {label}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Every project in the portfolio as a looping strip of teasers along
          the bottom, the open one centred (z-50, beside the nav). */}
      <ProjectStrip
        items={items}
        activeIndex={activeProject ? items.findIndex((it) => it.slug === activeProject.slug) : -1}
        visible={opened && stripUp && items.length > 1}
        isLandscape={isLandscape}
        width={width}
        height={height}
        isTouch={isTouch}
        onSelect={goToProject}
      />

      {/* Opening gate (z-80): pick a portfolio, then the intro reveal runs
          with that one already loaded. It also repeats the Resumé/Contact
          links, so the popup sits above it at z-90. */}
      {!started && (
        <AgentIntro
          onChoose={chooseStart}
          onOpenInfo={openInfo}
          hiding={splashHiding}
          width={width}
          height={height}
        />
      )}

      {/* Resumé / Contact popup — above everything, including the splash. */}
      {infoModal && (
        <InfoModal kind={infoModal} onClose={closeInfo} height={height} />
      )}
    </main>
  );
}
