"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY, usePortfolios, type PortfolioId } from "@/lib/portfolios";
import { ScrollEngine } from "@/lib/ScrollEngine";
import { useViewport } from "@/lib/useViewport";
import Menu from "./Menu";
import Gallery from "./Gallery";
import ProjectModal, { type ActiveProject } from "./project/ProjectModal";
import InfoModal, { type InfoKind } from "./InfoModal";
import PsychedelicFX from "./PsychedelicFX";

const DRAG_MULTIPLIER = 1.6;
const FLING_MULTIPLIER = 14;

export default function PortfolioApp() {
  const viewport = useViewport();
  const portfolios = usePortfolios();
  const [portfolio, setPortfolio] = useState<PortfolioId>("interactive");
  const [opened, setOpened] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [intro, setIntro] = useState(false);
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

  // Crossfade the switch: fade the gallery + menu list out to the gray
  // backdrop, swap underneath, fade back in — instead of a hard remount.
  const selectPortfolio = useCallback(
    (id: PortfolioId) => {
      if (openedRef.current || id === portfolio) return;
      setSwitching(true);
      clearTimeout(switchTimer.current);
      switchTimer.current = setTimeout(() => {
        setPortfolio(id);
        engine.reset();
        setSwitching(false);
      }, 220);
    },
    [engine, portfolio]
  );

  useEffect(() => () => clearTimeout(switchTimer.current), []);

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
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let flingVelocity = 0;
    let active = false; // pointer is down
    let dragging = false; // threshold crossed — suppress clicks
    let downOnGallery = false;

    const THRESHOLD = 4;

    const onWheel = (e: WheelEvent) => {
      if (openedRef.current || infoOpenRef.current) return;
      e.preventDefault();
      const delta =
        e.deltaMode === 1 ? e.deltaY * 16
        : e.deltaMode === 2 ? e.deltaY * window.innerHeight
        : e.deltaY;
      engine.target += delta;
      engine.notifyInput();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (openedRef.current || infoOpenRef.current) return;
      active = true;
      dragging = false;
      downOnGallery =
        !!galleryRef.current && galleryRef.current.contains(e.target as Node);
      startY = e.clientY;
      lastY = e.clientY;
      lastTime = performance.now();
      flingVelocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active) return;
      const dy = lastY - e.clientY;
      if (!dragging && Math.abs(e.clientY - startY) > THRESHOLD) {
        dragging = true;
        engine.setInputHeld(true);
        document.body.style.cursor = "grabbing";
      }
      if (!dragging) return;
      engine.target += dy * DRAG_MULTIPLIER;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      flingVelocity = (dy / dt) * 16.7;
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
  }, [engine, openProject]);

  const ready = !!viewport && !!portfolios;

  // Fire the intro animation once, the first time both viewport and portfolios
  // are available (i.e. the first non-null render). A short delay lets the
  // browser paint the initial frame before elements start moving.
  useEffect(() => {
    if (!ready || introFired.current) return;
    introFired.current = true;
    const t = setTimeout(() => setIntro(true), 60);
    return () => clearTimeout(t);
  }, [ready]);

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

  return (
    <main
      className="relative w-full overflow-hidden bg-[#f8f8f8] text-white"
      style={{ height }}
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

      {/* Scrollable project content overlay — below the close button (z-50). */}
      <ProjectModal project={activeProject} opened={opened} height={height} />

      {/* Resumé / Contact popup — above everything (z-70). */}
      {infoModal && <InfoModal kind={infoModal} onClose={closeInfo} />}

      <button
        type="button"
        onClick={closeProject}
        aria-label="Close project"
        className="fixed right-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-[#111111] shadow-lg transition-opacity duration-300"
        style={{
          opacity: opened ? 1 : 0,
          pointerEvents: opened ? "auto" : "none",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      </button>
    </main>
  );
}
