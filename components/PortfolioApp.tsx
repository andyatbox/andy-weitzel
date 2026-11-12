"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY, LABELS, PORTFOLIO_IDS, usePortfolios, type PortfolioId } from "@/lib/portfolios";
import {
  asPanel,
  currentRoute,
  prettySlug,
  routeHref,
  routeTitle,
  type Panel,
  type Route,
} from "@/lib/routes";
import { isPageViewWorthy, pageView } from "@/lib/analytics";
import { ScrollEngine } from "@/lib/ScrollEngine";
import { useViewport } from "@/lib/useViewport";
import Menu from "./Menu";
import { railWidth } from "@/lib/rail";
import Gallery from "./Gallery";
import ProjectModal, { type ActiveProject } from "./project/ProjectModal";
import ProjectStrip from "./project/ProjectStrip";
import InfoModal, { type InfoKind } from "./InfoModal";
import ReelOverlay from "./ReelOverlay";
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

export default function PortfolioApp({
  initialPortfolio = null,
  initialSlug = null,
}: {
  /** The portfolio the address named; null is the landing gate. */
  initialPortfolio?: PortfolioId | null;
  /** The project the address named, if it named one. */
  initialSlug?: string | null;
}) {
  // An address that names a portfolio skips the gate, and one that names a
  // project arrives with it already open: someone sent a link to a piece of
  // work should land on the work, not watch the arrival sequence play at them
  // first and then jump.
  const deepProject = !!(initialPortfolio && initialSlug);
  // The overlays are a query rather than a path, and the route segment
  // deliberately doesn't read it — it is the one part of the address only the
  // browser acts on — so it is picked up here instead.
  const [initialPanel] = useState<Panel | null>(() =>
    typeof window === "undefined"
      ? null
      : asPanel(new URLSearchParams(window.location.search).get("panel"))
  );
  const viewport = useViewport();
  const portfolios = usePortfolios();
  const [portfolio, setPortfolio] = useState<PortfolioId>(
    initialPortfolio ?? "interactive"
  );
  const [opened, setOpened] = useState(deepProject);
  // True only once the teaser has finished growing to full screen; gates the
  // project sheet's reveal.
  const [expandDone, setExpandDone] = useState(deepProject);
  // The bottom teaser strip, held back until STRIP_DELAY_MS after expandDone.
  const [stripUp, setStripUp] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(
    deepProject && initialPortfolio && initialSlug
      ? {
          slug: initialSlug,
          // Stands in for one render. The real title comes with the dataset
          // (see the effect by `ready`), long before the sheet fades up.
          title: prettySlug(initialSlug),
          category: CATEGORY[initialPortfolio],
        }
      : null
  );
  const [intro, setIntro] = useState(deepProject);
  // Slide-reveal intro: the menu/gallery panel starts pushed off by the canvas
  // size (menu parked at the window edge), a hero logo sits centered in the
  // exposed empty area, then the panel slides home.
  const [slideIn, setSlideIn] = useState(deepProject);
  const [introLogo, setIntroLogo] = useState(!deepProject);
  // Splash gate: a full-page black overlay asks which portfolio to open in.
  // `started` flips once the choice has been made and the splash has faded,
  // which is what releases the gallery intro below.
  const [started, setStarted] = useState(!!initialPortfolio);
  const [splashHiding, setSplashHiding] = useState(false);
  // Resumé / Contact popup + the halftone trigger (hovering those buttons or
  // having their modal open).
  const [infoModal, setInfoModal] = useState<InfoKind | null>(
    initialPanel === "resume" || initialPanel === "contact" ? initialPanel : null
  );
  const [reelOpen, setReelOpen] = useState(initialPanel === "reel");
  const [infoHover, setInfoHover] = useState(false);
  // Press-and-hold on the menu logo: the effect, on any device.
  const [logoHeld, setLogoHeld] = useState(false);
  // The gallery's WebGL canvas, sampled by the post-process distortion.
  const [galleryCanvas, setGalleryCanvas] = useState<HTMLCanvasElement | null>(null);
  const introFired = useRef(deepProject);
  const openedRef = useRef(deepProject);
  // True while a Resumé/Contact modal is open, so the global wheel/drag scroll
  // stands down and the modal can scroll natively.
  const infoOpenRef = useRef(initialPanel !== null);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const switchTimer2 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeThenSwitchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A step of a back/forward move that has to wait for the one before it to
  // finish animating (see applyRoute).
  const routeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // True until the splash is dismissed, so window-level scroll/drag and the
  // hover tooltip stand down while the gate is up.
  const splashOpenRef = useRef(!initialPortfolio);
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
  // Open from the first frame when the address named a project, so the
  // teaser is full-screen on arrival instead of growing into it.
  const animRef = useRef({ t: deepProject ? 1 : 0, w: 0, h: 0, animating: false });
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

  // ---- The address bar ----------------------------------------------------
  //
  // The app moves its own URL instead of routing to it. Every address on the
  // site resolves to one page component (see app/[[...path]]/page.tsx), so a
  // push here changes the address and the history stack without unmounting
  // anything: the two WebGL contexts, the video decode and the scroll
  // position all carry on through a move from a portfolio to a project,
  // which is the whole point of the animation that move plays.
  //
  // `silent` is up wherever a push would be wrong — while the back/forward
  // buttons are being played back into state, since that entry is already in
  // the stack, and across the first half of a move whose last step is what
  // the address should say.
  const silent = useRef(false);
  const routeRef = useRef<Route>({
    portfolio: initialPortfolio,
    slug: deepProject ? initialSlug : null,
    panel: initialPanel,
  });

  /** A route's title, with the project's real one if the dataset is in. */
  const titleFor = useCallback((route: Route) => {
    const item = route.slug
      ? itemsRef.current.find((it) => it.slug === route.slug)
      : null;
    return routeTitle(route, item?.title);
  }, []);

  /**
   * Move to an address. Everything the visitor can click goes through here,
   * so what the address bar says and what is on screen cannot drift apart.
   */
  const go = useCallback(
    (next: Partial<Route>, opts?: { replace?: boolean; force?: boolean }) => {
      if (silent.current && !opts?.force) return;
      const prev = routeRef.current;
      const route = { ...prev, ...next };
      routeRef.current = route;
      const url = routeHref(route);
      const title = titleFor(route);
      document.title = title;
      if (url === window.location.pathname + window.location.search) return;
      if (opts?.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      // The address and the title always follow the move; only the count is
      // selective — see isPageViewWorthy.
      if (isPageViewWorthy(prev, route)) pageView(url, title);
    },
    [titleFor]
  );

  /** Put the overlays where an address says they are. */
  const applyPanel = useCallback((panel: Panel | null) => {
    infoOpenRef.current = panel !== null;
    setInfoModal(panel === "resume" || panel === "contact" ? panel : null);
    setReelOpen(panel === "reel");
  }, []);

  // Switch the portfolio by replaying the slide intro: slide the panel out to
  // the parked (pre-intro) state — exposing the logo-bg — swap the portfolio
  // off-screen, then slide it back in. Orientation-aware via `slideTransform`.
  const selectPortfolio = useCallback(
    (id: PortfolioId, after?: () => void) => {
      if (openedRef.current || id === portfolio || switchingRef.current) return;
      go({ portfolio: id, slug: null });
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
            // Whatever was waiting on the switch — a back/forward that landed
            // on a project in the other portfolio — runs from here rather
            // than from a guess at how long the slide takes.
            after?.();
          }, SLIDE_DUR);
        };
        const urls = portfolios ? portfolios[id].items.map((it) => it.image) : [];
        void Promise.all(urls.map(preloadImage)).then(() =>
          requestAnimationFrame(() => requestAnimationFrame(slideHome))
        );
        switchTimer2.current = setTimeout(slideHome, SWITCH_LOAD_CAP);
      }, SLIDE_DUR);
    },
    [engine, go, portfolio, portfolios]
  );

  useEffect(
    () => () => {
      clearTimeout(switchTimer.current);
      clearTimeout(switchTimer2.current);
      clearTimeout(closeThenSwitchTimer.current);
      clearTimeout(splashTimer.current);
      clearTimeout(routeTimer.current);
    },
    []
  );

  // Splash choice: set the portfolio the gallery will open in, fade the
  // overlay out, and only then release the intro (which holds on the hero
  // logo before sliding the gallery home).
  const chooseStart = useCallback(
    (id: PortfolioId) => {
      if (splashHiding) return;
      go({ portfolio: id, slug: null });
      setPortfolio(id);
      engine.reset();
      splashOpenRef.current = false;
      setSplashHiding(true);
      clearTimeout(splashTimer.current);
      splashTimer.current = setTimeout(() => setStarted(true), SPLASH_FADE);
    },
    [engine, go, splashHiding]
  );

  // The menu logo, tapped: back to the landing. The landing fades in over the
  // gallery; once it covers everything, the gallery's own intro is rearmed
  // out of sight, so choosing a portfolio again plays it as on first arrival.
  const returnToLanding = useCallback(() => {
    if (openedRef.current || switchingRef.current || splashOpenRef.current) return;
    go({ portfolio: null, slug: null, panel: null });
    splashOpenRef.current = true;
    setInfoHover(false);
    setLogoHeld(false);
    // Mount hidden, then fade in on the next frame (AgentIntro's opacity
    // transition needs a frame at 0 to run from).
    setSplashHiding(true);
    setStarted(false);
    clearTimeout(splashTimer.current);
    requestAnimationFrame(() => requestAnimationFrame(() => setSplashHiding(false)));
    splashTimer.current = setTimeout(() => {
      introFired.current = false;
      setIntro(false);
      setSlideIn(false);
      setIntroLogo(true);
    }, SPLASH_FADE + 50);
  }, [go]);

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
    go({ slug: item.slug });
  }, [engine, go]);

  const closeProject = useCallback(() => {
    openedRef.current = false;
    setOpened(false);
    go({ slug: null });
  }, [go]);

  // Portfolio pills in the open-project nav: close the project back to the
  // gallery, then — once that close has visually settled — replay the normal
  // portfolio-switch slide. See PROJECT_CLOSE_MS for why this waits.
  const switchPortfolioFromProject = useCallback(
    (id: PortfolioId, after?: () => void) => {
      // One history entry for the whole move: the project closing on its way
      // to another portfolio isn't a place anyone can come back to, so the
      // address is left alone until the switch itself sets it.
      const was = silent.current;
      silent.current = true;
      closeProject();
      silent.current = was;
      clearTimeout(closeThenSwitchTimer.current);
      closeThenSwitchTimer.current = setTimeout(
        () => selectPortfolio(id, after),
        PROJECT_CLOSE_MS
      );
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
      go({ slug: item.slug });
    },
    [engine, go]
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

  const openInfo = useCallback(
    (kind: InfoKind) => {
      infoOpenRef.current = true;
      setInfoModal(kind);
      go({ panel: kind });
    },
    [go]
  );
  const closeInfo = useCallback(() => {
    infoOpenRef.current = false;
    setInfoModal(null);
    go({ panel: null });
  }, [go]);

  // The reel rides the same gate as the info panels: `infoOpenRef` is what
  // tells the window-level scroll/drag handlers and the hover tooltip to
  // stand down, and an overlay covering the gallery wants exactly that.
  const openReel = useCallback(() => {
    infoOpenRef.current = true;
    setInfoModal(null);
    setReelOpen(true);
    go({ panel: "reel" });
  }, [go]);
  const closeReel = useCallback(() => {
    infoOpenRef.current = false;
    setReelOpen(false);
    go({ panel: null });
  }, [go]);

  /**
   * Open the project with this slug, in the portfolio showing now. The
   * address bar's way in — a direct link, or back and forward — never a
   * click, which already knows which teaser it is on.
   */
  const openSlug = useCallback(
    (slug: string, opts?: { jump?: boolean }) => {
      const index = itemsRef.current.findIndex((it) => it.slug === slug);
      if (index < 0) {
        // Nothing in this portfolio carries that slug. Show the portfolio and
        // say so in the address bar, rather than hold an empty sheet open on
        // a dead link. Forced, because correcting a bad address is the one
        // push that has to go through while an address is being played back,
        // and a replace so the dead link leaves no entry behind.
        if (openedRef.current) {
          openedRef.current = false;
          setOpened(false);
        }
        setActiveProject(null);
        go({ slug: null }, { replace: true, force: true });
        return;
      }
      const item = itemsRef.current[index];
      setActiveProject({
        slug: item.slug,
        title: item.title,
        category: CATEGORY[portfolioRef.current],
      });
      // Already open: let the engine carry the full-screen teaser across
      // behind the sheet, the way prev/next does. Otherwise simply be there.
      if (opts?.jump || !openedRef.current) engine.jumpToIndex(index);
      else engine.scrollToIndex(index);
      if (!openedRef.current) {
        openedRef.current = true;
        setOpened(true);
      }
    },
    [engine, go]
  );

  /**
   * Drive the app to match an address. Only the back and forward buttons come
   * through here; everything else changes state and pushes as it goes.
   *
   * A move can take more than one step — a portfolio slides out and back
   * before a project inside it can open over the top — so the steps that
   * have an end run the next one from it.
   */
  const applyRoute = useCallback(
    (route: Route) => {
      clearTimeout(routeTimer.current);
      applyPanel(route.panel);

      if (!route.portfolio) {
        if (openedRef.current) closeProject();
        returnToLanding();
        return;
      }

      const slug = route.slug;
      const openAfter = slug ? () => openSlug(slug) : undefined;

      // Back to the gate and forward again: choosing releases the whole
      // arrival sequence, and a project can only open once that has run.
      if (splashOpenRef.current) {
        chooseStart(route.portfolio);
        if (openAfter) {
          routeTimer.current = setTimeout(
            openAfter,
            SPLASH_FADE + SLIDE_HOLD + SLIDE_DUR
          );
        }
        return;
      }

      if (route.portfolio !== portfolioRef.current) {
        if (openedRef.current) switchPortfolioFromProject(route.portfolio, openAfter);
        else selectPortfolio(route.portfolio, openAfter);
        return;
      }

      if (slug) openSlug(slug);
      else if (openedRef.current) closeProject();
    },
    [
      applyPanel,
      chooseStart,
      closeProject,
      openSlug,
      returnToLanding,
      selectPortfolio,
      switchPortfolioFromProject,
    ]
  );

  // Back and forward. That entry is already in the stack, so nothing here may
  // push — `silent` holds the handlers' own pushes off while the address is
  // played back into state.
  useEffect(() => {
    const onPop = () => {
      const route = currentRoute();
      const prev = routeRef.current;
      routeRef.current = route;
      silent.current = true;
      try {
        applyRoute(route);
      } finally {
        silent.current = false;
      }
      const title = titleFor(route);
      document.title = title;
      // Back out of a project is the same return as closing it, and is left
      // uncounted for the same reason.
      if (isPageViewWorthy(prev, route)) pageView(routeHref(route), title);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyRoute, titleFor]);

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

  // A directly linked project. The dataset is in by now, so put the strip on
  // it — without travelling there, since it is meant to have been there all
  // along — and take its real title. Nothing has painted yet (this component
  // renders null until the viewport and the portfolios are both in hand), so
  // this still is the first frame, which is why it is a layout effect.
  const deepResolved = useRef(false);
  useLayoutEffect(() => {
    if (!ready || !deepProject || !initialSlug || deepResolved.current) return;
    deepResolved.current = true;
    openSlug(initialSlug, { jump: true });
    document.title = titleFor(routeRef.current);
  }, [ready, deepProject, initialSlug, openSlug, titleFor]);

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
    // The rail is a quarter of the window plus whatever inset a wide display
    // earns, so the canvas is simply what's left — not a fixed three quarters.
    const rail = railWidth(width, isLandscape);
    const closed = isLandscape
      ? { left: rail, top: 0, width: width - rail, height }
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
  const halftone = (!isTouch && infoHover) || infoModal !== null || logoHeld;

  // Menu docks in its corner; the layout effect slides it off via transform.
  const rail = railWidth(width, isLandscape);
  const canvasW = width - rail;
  const menuRect = isLandscape
    ? { left: 0, top: 0, width: rail, height }
    : { left: 0, top: height * 0.6, width, height: height * 0.4 };

  // Intro: push the whole panel off by the canvas size so the menu parks at the
  // window edge; the hero logo centers in the exposed (canvas-sized) gap.
  const slideTransform = slideIn
    ? "none"
    : isLandscape
      ? `translateX(${canvasW}px)`
      : `translateY(${-(height * 0.6)}px)`;
  const heroRect: React.CSSProperties = isLandscape
    ? { left: 0, top: 0, width: canvasW, height }
    : { left: 0, top: height * 0.4, width, height: height * 0.6 };

  return (
    <main
      className="relative w-full overflow-hidden bg-[#070707] text-white"
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
            onOpenReel={openReel}
            onInfoHover={setInfoHover}
            onHome={returnToLanding}
            onLogoHold={setLogoHeld}
          />
        </div>

        {/* Static gray backdrop stays put; only the canvas inside fades, so the
            crossfade passes through gray rather than flashing the dark page. */}
        <div
          ref={galleryRef}
          className="absolute touch-none overflow-hidden bg-[#070707]"
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
          onOpenReel={openReel}
          hiding={splashHiding}
          width={width}
          height={height}
        />
      )}

      {/* Resumé / Contact popup — above everything, including the splash. */}
      {infoModal && (
        <InfoModal kind={infoModal} onClose={closeInfo} height={height} />
      )}

      {/* The sizzle reel, flat and full-screen — the landing gate's shape and
          sky play the same stream through WebGL. */}
      {reelOpen && <ReelOverlay onClose={closeReel} height={height} />}
    </main>
  );
}
