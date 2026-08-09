"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY, LABELS, PORTFOLIO_IDS, usePortfolios, type PortfolioId } from "@/lib/portfolios";
import { ScrollEngine } from "@/lib/ScrollEngine";
import { useViewport } from "@/lib/useViewport";
import Menu from "./Menu";
import Gallery from "./Gallery";
import ProjectModal, { type ActiveProject } from "./project/ProjectModal";
import InfoModal, { type InfoKind } from "./InfoModal";
import PsychedelicFX from "./PsychedelicFX";
import SplashIntro from "./SplashIntro";

const DRAG_MULTIPLIER = 1.6;
const FLING_MULTIPLIER = 14;
// Slide-reveal timing (ms), shared by the intro and portfolio switches.
const SLIDE_HOLD = 1700;
const SLIDE_DUR = 950;
// Cap on how long a switch waits for the new portfolio's images before sliding
// in anyway (so a slow/failed image can't strand the panel off-screen).
const SWITCH_LOAD_CAP = 3500;
// How long the open-project close transition (gallery shrink + modal fade)
// takes to visually settle. The portfolio-switch slide-out below assumes the
// gallery is already at its closed (75%-width) size — sliding it off-screen
// while it's still full-screen undershoots, leaving a sliver of it hanging
// over the hero-logo reveal. Switching from an open project waits this long
// before starting the switch, so it starts from an already-closed gallery.
const PROJECT_CLOSE_MS = 750;
// Splash fade-out (must match the transition duration in SplashIntro). The
// gallery intro only starts once this has finished.
const SPLASH_FADE = 600;

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

  // Prev/next within the open project's portfolio (wraps at the ends). The
  // modal fades out on the project change while the engine slides the
  // full-screen teaser behind it to the new item, then the content fades in.
  const navigateProject = useCallback(
    (dir: 1 | -1) => {
      const list = itemsRef.current;
      const cur = activeProjectRef.current;
      if (!cur || list.length < 2) return;
      const idx = list.findIndex((it) => it.slug === cur.slug);
      const next = ((idx < 0 ? 0 : idx) + dir + list.length) % list.length;
      const item = list[next];
      setActiveProject({
        slug: item.slug,
        title: item.title,
        category: CATEGORY[portfolioRef.current],
      });
      engine.scrollToIndex(next);
    },
    [engine]
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
      engine.target += delta;
      engine.notifyInput();
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
        engine.target += flingVelocity * FLING_MULTIPLIER;
        engine.setInputHeld(false);
        document.body.style.cursor = "";
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
    };
  }, [engine, openProject, isTouch]);

  const ready = !!viewport && !!portfolios;

  // Cursor-following "View … Project" tooltip over the gallery teasers.
  // Non-touch only; hidden while dragging, while a project or info modal is
  // open, and during portfolio switches. Driven imperatively (no re-renders).
  //
  // The label is refreshed on a frame loop rather than only on pointermove:
  // scrolling changes which teaser sits under a stationary cursor, and a
  // move-only update left the tooltip naming the previous project until the
  // mouse happened to twitch. Position still tracks pointermove alone.
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
    let raf = 0;

    const hide = () => {
      tip.style.opacity = "0";
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
    };

    const tick = () => {
      paint();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      overGallery =
        !!galleryRef.current && galleryRef.current.contains(e.target as Node);
      // Vertically centered on the cursor (the -50% resolves against the
      // pill's own height); horizontally, the -100% (against its own width)
      // pulls it fully to the left, with a 16px gap before the cursor.
      tip.style.transform = `translate(calc(${e.clientX}px - 100% - 16px), calc(${e.clientY}px - 50%))`;
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
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
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

    let raf = 0;
    const tick = () => {
      anim.t += (target - anim.t) * 0.14;
      if (Math.abs(target - anim.t) < 0.001) anim.t = target;
      apply(anim.t);
      if (anim.t !== target) {
        raf = requestAnimationFrame(tick);
      } else {
        anim.animating = false;
      }
    };
    apply(anim.t); // sync immediately (first mount + resize-while-open)
    if (anim.t !== target) {
      anim.animating = true;
      raf = requestAnimationFrame(tick);
    } else {
      anim.animating = false;
    }
    return () => cancelAnimationFrame(raf);
    // `ready` is included so this re-runs once the gallery div is actually
    // rendered (the component returns null until data + viewport are ready),
    // otherwise the canvas would never get its imperative size.
  }, [opened, viewport, anim, ready]);

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
            onOpenInfo={openInfo}
            onInfoHover={setInfoHover}
          />
        </div>

        {/* Static gray backdrop stays put; only the canvas inside fades, so the
            crossfade passes through gray rather than flashing the dark page. */}
        <div
          ref={galleryRef}
          className="absolute touch-none overflow-hidden bg-[#f8f8f8]"
          style={{ opacity: intro ? 1 : 0, transition: "opacity 0.7s ease 80ms" }}
        >
          <div
            className="h-full w-full"
            style={{ opacity: switching ? 0 : 1, transition: "opacity 0.22s ease" }}
          >
            <Gallery
              items={items}
              portfolio={portfolio}
              isLandscape={isLandscape}
              engine={engine}
              opened={opened}
              anim={anim}
              onIndexChange={() => {}}
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

      {/* Cursor-following teaser tooltip (non-touch only, z-30 — under the
          project overlay). Positioned/filled imperatively from the pointer
          effect above. */}
      {!isTouch && (
        <div
          ref={tooltipRef}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-30 whitespace-nowrap rounded-full bg-white/80 px-3.5 py-1.5 text-sm font-medium text-black shadow-lg backdrop-blur-md"
          style={{ opacity: 0, transition: "opacity 0.15s ease", willChange: "transform" }}
        />
      )}

      {/* Scrollable project content overlay — below the close button (z-50). */}
      <ProjectModal project={activeProject} opened={opened} height={height} />

      {/* Back + portfolio-switch nav — top-left. Inverted from the old close
          X: white buttons, black stroke, black text. The back arrow closes
          the project; the pills below switch portfolios (closing first). */}
      <div
        className="fixed left-5 top-5 z-50 flex flex-col items-start gap-2 transition-opacity duration-300"
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
          label after the chevron. Unlike the other nav buttons these don't
          invert color on hover — only the shape animates. */}
      <div
        className="fixed right-5 top-5 z-50 flex flex-col items-end gap-2 transition-opacity duration-300"
        style={{
          opacity: opened && items.length > 1 ? 1 : 0,
          pointerEvents: opened && items.length > 1 ? "auto" : "none",
        }}
      >
        <button
          type="button"
          onClick={() => navigateProject(-1)}
          aria-label="Previous project"
          className="group flex h-11 w-11 items-center overflow-hidden whitespace-nowrap rounded-full bg-white pl-[13px] text-black shadow-lg ring-2 ring-inset ring-black transition-[width] duration-300 ease-out hover:w-[185px]"
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
            <polyline points="18 15 12 9 6 15" />
          </svg>
          <span className="ml-2 text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Previous Project
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigateProject(1)}
          aria-label="Next project"
          className="group flex h-11 w-11 items-center overflow-hidden whitespace-nowrap rounded-full bg-white pl-[13px] text-black shadow-lg ring-2 ring-inset ring-black transition-[width] duration-300 ease-out hover:w-[185px]"
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
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="ml-2 text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Next Project
          </span>
        </button>
      </div>

      {/* Opening gate (z-80): pick a portfolio, then the intro reveal runs
          with that one already loaded. It also repeats the Resumé/Contact
          links, so the popup sits above it at z-90. */}
      {!started && (
        <SplashIntro
          onChoose={chooseStart}
          onOpenInfo={openInfo}
          hiding={splashHiding}
          height={height}
        />
      )}

      {/* Resumé / Contact popup — above everything, including the splash. */}
      {infoModal && <InfoModal kind={infoModal} onClose={closeInfo} />}
    </main>
  );
}
