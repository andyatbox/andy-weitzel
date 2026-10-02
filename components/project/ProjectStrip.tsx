"use client";

import { useEffect, useRef } from "react";
import type { PortfolioItem } from "@/lib/portfolios";

// Thumb heights (px). Minimized it's just a row of thumbs; enlarged — on hover,
// and always on portrait phones and on landscape screens 1200px or taller — the
// thumbs grow and their titles show underneath.
const MIN_H = 44;
const MAX_H_LANDSCAPE = 92;
const MAX_H_PORTRAIT = 62;
const ASPECT = 16 / 9;
const PAD_Y = 10;
const TITLE_GAP = 6;
// How far each thumb's image overhangs its frame on every side, as a share of
// the frame. That overhang is the room the parallax has to move in.
const OVERSCAN = 0.2;
// Share of the frame width each parallax source may shift the image by. Their
// sum stays inside OVERSCAN, so an image edge never shows inside a frame.
const PARALLAX_POSITION = 0.1;
const PARALLAX_MOUSE = 0.05;
const PARALLAX_VELOCITY = 0.05;
// After the visitor scrolls or drags the strip away from the open project, it
// drifts back to centre it once they've left it alone this long.
const RECENTRE_MS = 3000;
const DRAG_THRESHOLD = 5;

/** The teaser image, at thumbnail size rather than the 1600px gallery size. */
function thumbUrl(src: string) {
  try {
    const u = new URL(src);
    u.searchParams.set("w", "480");
    u.searchParams.set("h", "270");
    return u.toString();
  } catch {
    return src;
  }
}

/** Wrap x into [-t/2, t/2): the signed distance on a loop of length t. */
function wrap(x: number, t: number) {
  return ((((x + t / 2) % t) + t) % t) - t / 2;
}

/**
 * Prev/next teaser strip along the bottom of an open project: every project in
 * the portfolio as a looping row of thumbs, the open one centred and outlined.
 * Click a thumb to go to it; scroll or drag the row (mouse or touch) to browse.
 *
 * Laid out imperatively each frame — like the menu list — so scrolling, the
 * glide between projects and the parallax never re-render React. The row is a
 * loop: enough copies of the list are kept that the seam is always off-screen.
 */
export default function ProjectStrip({
  items,
  activeIndex,
  visible,
  isLandscape,
  width,
  height,
  isTouch,
  onSelect,
}: {
  items: PortfolioItem[];
  /** Index of the open project in `items`, or -1. */
  activeIndex: number;
  visible: boolean;
  isLandscape: boolean;
  width: number;
  height: number;
  isTouch: boolean;
  onSelect: (index: number) => void;
}) {
  const n = items.length;
  const minPitch = MIN_H * ASPECT + 8;
  // Enough copies that the loop is wider than the window plus a thumb either
  // side, at the smallest (most numerous) thumb size.
  const reps = n ? Math.max(1, Math.ceil((width / minPitch + 3) / n)) : 0;
  const total = n * reps;
  const forced = !isLandscape || height >= 1200;
  const maxH = isLandscape ? MAX_H_LANDSCAPE : MAX_H_PORTRAIT;
  const titleH = isLandscape ? 18 : 15;

  const trackRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const frameRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const imgRefs = useRef<(HTMLImageElement | null)[]>([]);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Everything the frame loop reads, kept off React state.
  const live = useRef({
    pos: 0, // item under the centre of the strip, continuous and unbounded
    target: 0,
    grow: forced ? 1 : 0,
    hover: false,
    mouse: 0, // pointer x across the window, -1..1, eased
    mouseTarget: 0,
    velPx: 0, // eased on-screen speed, for the motion parallax
    lastInteract: -Infinity,
    shownActive: -2,
    wasVisible: false,
    justDragged: false,
  });
  const props = useRef({ activeIndex, visible, forced, maxH, titleH, n, total, width, isTouch });
  props.current = { activeIndex, visible, forced, maxH, titleH, n, total, width, isTouch };

  // The drag in progress, if any (see the drag/wheel effect below).
  const drag = useRef<{
    id: number;
    startX: number;
    startPos: number;
    lastX: number;
    lastT: number;
    vel: number; // items per ms
    moved: boolean;
  } | null>(null);

  // Frame loop: runs only while the strip is up.
  useEffect(() => {
    if (!visible || n === 0) return;
    const L = live.current;
    let raf = 0;
    let last = performance.now();
    let prevPos = L.pos;

    const tick = (now: number) => {
      const P = props.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Arriving: sit on the open project immediately, no glide in from
      // wherever the strip was last time.
      if (!L.wasVisible) {
        L.wasVisible = true;
        L.pos = L.target = Math.max(0, P.activeIndex);
        L.shownActive = P.activeIndex;
        prevPos = L.pos;
      }
      // The open project changed (prev/next, a thumb): glide to it the short
      // way round the loop.
      if (P.activeIndex !== L.shownActive) {
        L.shownActive = P.activeIndex;
        if (P.activeIndex >= 0) L.target += wrap(P.activeIndex - L.target, P.n);
        L.lastInteract = -Infinity;
      }
      // Left alone after browsing: drift back to centre the open project.
      if (
        P.activeIndex >= 0 &&
        !L.hover &&
        !drag.current &&
        now - L.lastInteract > RECENTRE_MS
      ) {
        const off = wrap(P.activeIndex - L.target, P.n);
        if (Math.abs(off) > 0.001) L.target += off;
      }

      if (!drag.current) L.pos += (L.target - L.pos) * (1 - Math.exp(-dt * 9));
      L.grow += ((P.forced || L.hover ? 1 : 0) - L.grow) * (1 - Math.exp(-dt * 10));
      L.mouse += (L.mouseTarget - L.mouse) * (1 - Math.exp(-dt * 6));

      const thumbH = MIN_H + (P.maxH - MIN_H) * L.grow;
      const thumbW = thumbH * ASPECT;
      const pitch = thumbW + 8 + 4 * L.grow;
      const barH = PAD_Y * 2 + thumbH + (TITLE_GAP + P.titleH) * L.grow;
      L.velPx += ((L.pos - prevPos) * pitch - L.velPx) * 0.3;
      prevPos = L.pos;

      const track = trackRef.current;
      if (track) track.style.height = `${barH}px`;
      const half = P.width / 2;
      const showTitles = L.grow > 0.02;
      const velShift = Math.max(-PARALLAX_VELOCITY, Math.min(PARALLAX_VELOCITY, -L.velPx * 0.004));

      for (let k = 0; k < P.total; k++) {
        const node = nodeRefs.current[k];
        if (!node) continue;
        const x = wrap(k - L.pos, P.total) * pitch;
        if (Math.abs(x) > half + pitch) {
          node.style.visibility = "hidden";
          continue;
        }
        node.style.visibility = "";
        node.style.width = `${thumbW}px`;
        node.style.transform = `translate3d(${x - thumbW / 2}px, 0, 0)`;
        const frame = frameRefs.current[k];
        if (frame) frame.style.height = `${thumbH}px`;
        // Parallax: the image inside each frame slides against the frame —
        // by the frame's distance from centre (so a glide between projects
        // pans every image), by the pointer, and by the strip's own speed.
        const img = imgRefs.current[k];
        if (img) {
          const fromCentre = Math.max(-1, Math.min(1, x / half));
          const shift = -fromCentre * PARALLAX_POSITION + L.mouse * PARALLAX_MOUSE + velShift;
          img.style.transform = `translate3d(${shift * thumbW}px, 0, 0)`;
        }
        const title = titleRefs.current[k];
        if (title) {
          title.style.opacity = String(L.grow);
          title.style.visibility = showTitles ? "" : "hidden";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      L.wasVisible = false;
    };
  }, [visible, n, total]);


  // Drag (mouse and touch) and wheel, on the strip itself.
  const pitchNow = () => {
    const L = live.current;
    const thumbH = MIN_H + (props.current.maxH - MIN_H) * L.grow;
    return thumbH * ASPECT + 8 + 4 * L.grow;
  };

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const L = live.current;
    let snapTimer: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (e: WheelEvent) => {
      if (!props.current.visible) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * window.innerWidth : d;
      L.target += px / pitchNow();
      L.lastInteract = performance.now();
      // Settle on a whole thumb once the wheel goes quiet.
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        L.target = Math.round(L.target);
      }, 140);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = {
        id: e.pointerId,
        startX: e.clientX,
        startPos: L.pos,
        lastX: e.clientX,
        lastT: performance.now(),
        vel: 0,
        moved: false,
      };
    };
    const onMove = (e: PointerEvent) => {
      const D = drag.current;
      if (!D || e.pointerId !== D.id) return;
      const dx = e.clientX - D.startX;
      if (!D.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        D.moved = true;
        // Captured only once it's really a drag: capturing on pointerdown
        // would retarget the click, and a plain tap on a thumb would stop
        // reaching its button.
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("cursor-drag");
      }
      const pitch = pitchNow();
      L.pos = D.startPos - dx / pitch;
      L.target = L.pos;
      const now = performance.now();
      const step = (D.lastX - e.clientX) / pitch;
      D.vel = step / Math.max(1, now - D.lastT);
      D.lastX = e.clientX;
      D.lastT = now;
      L.lastInteract = now;
    };
    const onUp = (e: PointerEvent) => {
      const D = drag.current;
      if (!D || e.pointerId !== D.id) return;
      drag.current = null;
      if (!D.moved) return;
      document.body.classList.remove("cursor-drag");
      // Fling, then land on a whole thumb.
      L.target = Math.round(L.pos + D.vel * 220);
      L.lastInteract = performance.now();
      L.justDragged = true;
      setTimeout(() => (L.justDragged = false), 0);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      clearTimeout(snapTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("cursor-drag");
    };
  }, []);

  // Pointer position across the window, for the mouse parallax (desktop).
  useEffect(() => {
    if (!visible || isTouch) return;
    const L = live.current;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") L.mouseTarget = (e.clientX / window.innerWidth) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [visible, isTouch]);

  if (n < 2) return null;

  // First-paint geometry, so nothing jumps before the loop's first frame.
  const h0 = forced ? maxH : MIN_H;
  const barH0 = PAD_Y * 2 + h0 + (forced ? TITLE_GAP + titleH : 0);

  return (
    <nav
      aria-label="Projects in this portfolio"
      aria-hidden={!visible}
      className="fixed inset-x-0 bottom-0 z-50 select-none bg-white/70 backdrop-blur-xl transition-opacity duration-300"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") live.current.hover = true;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          live.current.hover = false;
          live.current.lastInteract = performance.now();
        }
      }}
    >
      {/* `overflow: clip`, not hidden: clipping doesn't make a scroll
          container, so keyboard focus landing on an off-centre thumb can't
          scroll the row out from under the layout. */}
      <div
        ref={trackRef}
        className="relative overflow-clip"
        style={{ height: barH0, touchAction: "none" }}
      >
        {Array.from({ length: total }, (_, k) => {
          const i = k % n;
          const item = items[i];
          const active = i === activeIndex;
          return (
            <button
              key={k}
              ref={(el) => void (nodeRefs.current[k] = el)}
              type="button"
              // One focus stop per project, not one per copy in the loop.
              tabIndex={visible && k < n ? 0 : -1}
              aria-label={item.title}
              aria-current={active ? "page" : undefined}
              data-active={active}
              className="group absolute left-1/2 text-left outline-none"
              style={{ top: PAD_Y, width: h0 * ASPECT, visibility: "hidden" }}
              onClick={() => {
                if (live.current.justDragged) return;
                live.current.lastInteract = -Infinity;
                onSelect(i);
              }}
              onFocus={(e) => {
                // Bring a keyboard-focused thumb to the centre.
                if (!e.currentTarget.matches(":focus-visible")) return;
                const L = live.current;
                L.target += wrap(i - L.target, n);
                L.lastInteract = performance.now();
              }}
            >
              <span
                ref={(el) => void (frameRefs.current[k] = el)}
                className="relative block overflow-hidden rounded-[6px] border-2 border-transparent opacity-60 transition-[opacity,border-color] duration-200 group-hover:opacity-100 group-focus-visible:border-black/60 group-data-[active=true]:border-black group-data-[active=true]:opacity-100"
                style={{ height: h0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={(el) => void (imgRefs.current[k] = el)}
                  src={thumbUrl(item.image)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="absolute max-w-none object-cover"
                  style={{
                    width: `${100 + OVERSCAN * 200}%`,
                    height: `${100 + OVERSCAN * 200}%`,
                    left: `${-OVERSCAN * 100}%`,
                    top: `${-OVERSCAN * 100}%`,
                  }}
                />
              </span>
              <span
                ref={(el) => void (titleRefs.current[k] = el)}
                className="block truncate leading-tight text-black/60 group-hover:text-black group-data-[active=true]:text-black"
                style={{
                  marginTop: TITLE_GAP,
                  fontSize: isLandscape ? 15 : 13,
                  opacity: forced ? 1 : 0,
                }}
              >
                {item.title}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
