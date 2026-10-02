"use client";

import { useEffect, useRef, type RefObject } from "react";

// Per-second easing rate toward the wheel's target. Around 8 the scroll trails
// the wheel by a beat and settles in roughly half a second: smooth without
// feeling detached from the hand.
const EASE = 8;

export interface SmoothScroll {
  /** Move straight to `y` with no glide (e.g. back to the top on a new project). */
  jumpTo: (y: number) => void;
}

/**
 * Eased wheel scrolling for one scroll container, in place of the browser's
 * stepped native scroll. The wheel moves a target; the real scrollTop glides
 * toward it each frame.
 *
 * Only the wheel is taken over. Touch keeps its native momentum (which is
 * already smooth, and fighting it feels wrong), as do the keyboard and the
 * scrollbar — if any of them moves the container mid-glide, the glide yields
 * to it rather than dragging the page back. Horizontal and pinch-zoom wheel
 * events pass through untouched, and reduced-motion visitors get native
 * scrolling.
 *
 * `pausedRef` stands the wheel handling down while something else owns the
 * wheel (the project slider's full-screen view swallows it at window level,
 * which runs *after* this container's listener).
 */
export function useSmoothScroll(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  pausedRef?: RefObject<boolean>
): RefObject<SmoothScroll> {
  const api = useRef<SmoothScroll>({ jumpTo: () => {} });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      api.current.jumpTo = (y) => (el.scrollTop = y);
      return;
    }

    let target = el.scrollTop;
    let current = target;
    let written = target; // the scrollTop this loop last set
    let animating = false;
    let raf = 0;
    let last = 0;

    const max = () => Math.max(0, el.scrollHeight - el.clientHeight);

    const step = (now: number) => {
      // Something other than this loop moved the page (keyboard, scrollbar
      // drag, focus): take its position and stop gliding.
      if (Math.abs(el.scrollTop - written) > 2) {
        target = current = written = el.scrollTop;
        animating = false;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      current += (target - current) * (1 - Math.exp(-dt * EASE));
      if (Math.abs(target - current) < 0.5) current = target;
      el.scrollTop = current;
      written = el.scrollTop; // read back: the browser rounds and clamps
      if (current !== target) raf = requestAnimationFrame(step);
      else animating = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || pausedRef?.current) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const d =
        e.deltaMode === 1 ? e.deltaY * 16
        : e.deltaMode === 2 ? e.deltaY * el.clientHeight
        : e.deltaY;
      // Starting fresh: pick up wherever the page is now, in case touch, the
      // keyboard or the scrollbar moved it since the last glide.
      if (!animating) target = current = written = el.scrollTop;
      target = Math.max(0, Math.min(max(), target + d));
      if (!animating) {
        animating = true;
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };

    api.current.jumpTo = (y: number) => {
      cancelAnimationFrame(raf);
      animating = false;
      el.scrollTop = y;
      target = current = written = el.scrollTop;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("wheel", onWheel);
      api.current.jumpTo = (y) => (el.scrollTop = y);
    };
  }, [ref, enabled, pausedRef]);

  return api;
}
