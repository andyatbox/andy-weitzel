"use client";

import { useEffect, useRef, type RefObject } from "react";

// What the ring is over, worked out from the element under the pointer. The
// teaser state isn't in this list: it comes from `body.cursor-teaser`, which the
// gallery tooltip sets when it shows a project's name.
const INTERACTIVE = 'a, button, [role="button"], summary, label, select, [data-cursor="link"]';
const DRAGGABLE = '.cursor-grab, [data-cursor="drag"]';
const TEXT_ENTRY = 'input, textarea, [contenteditable="true"]';

// Per-frame easing toward the pointer (0..1). Below 1 so the ring trails the
// pointer slightly — the fluid feel — rather than sticking to it like the
// native cursor.
const FOLLOW = 0.26;

/**
 * Custom cursor for fine pointers (mouse, trackpad): a ring and a dot that
 * trail the pointer and change with what's under it — growing over links,
 * swelling into a lens over gallery teasers (with the teaser's name in a pill
 * beside it), and going dashed over things that drag. The native cursor is
 * hidden everywhere except over text fields, where the caret is more useful.
 *
 * The ring and dot invert what's under them (mix-blend-mode: difference), so
 * they read on the white menu, the black landing page and over images alike.
 * The name pill is a separate element because blending it would invert its
 * text too.
 *
 * State lives in classes on <html>/<body>, and position is written straight to
 * the DOM each frame, so following the pointer never re-renders React.
 */
export default function Cursor({ tooltipRef }: { tooltipRef: RefObject<HTMLDivElement | null> }) {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const ring = ringRef.current;
    if (!ring) return;
    const root = document.documentElement;
    root.classList.add("has-cursor");

    let x = -200;
    let y = -200;
    let cx = x;
    let cy = y;
    let seen = false;
    let raf = 0;

    const setState = (state: "idle" | "link" | "drag" | "native") => {
      if (ring.dataset.state !== state) ring.dataset.state = state;
    };

    const classify = (t: Element | null) => {
      if (!t) return setState("idle");
      if (t.closest(TEXT_ENTRY)) return setState("native");
      if (t.closest(INTERACTIVE)) return setState("link");
      if (t.closest(DRAGGABLE)) return setState("drag");
      setState("idle");
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      if (!seen) {
        // First sighting: appear where the pointer is, not glide in from a corner.
        seen = true;
        cx = x;
        cy = y;
      }
      ring.classList.add("is-visible");
      classify(e.target instanceof Element ? e.target : null);
    };

    // Scrolling changes what's under a cursor that hasn't moved — without
    // this it kept the look of whatever it was last over (the slider's dashed
    // drag ring stayed on over plain text). Checked once per frame at most.
    let rescanQueued = false;
    const onScroll = () => {
      if (!seen || rescanQueued) return;
      rescanQueued = true;
      requestAnimationFrame(() => {
        rescanQueued = false;
        classify(document.elementFromPoint(x, y));
      });
    };
    const onDown = () => ring.classList.add("is-down");
    const onUp = () => ring.classList.remove("is-down");
    const onLeave = () => ring.classList.remove("is-visible");

    const tick = () => {
      cx += (x - cx) * FOLLOW;
      cy += (y - cy) * FOLLOW;
      ring.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      // The name pill rides with the ring, pulled fully to its left with a gap
      // that clears the swollen teaser-state ring.
      const tip = tooltipRef.current;
      if (tip) tip.style.transform = `translate(calc(${cx}px - 100% - 58px), calc(${cy}px - 50%))`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    // Capture phase: scroll doesn't bubble, and the scrolling element is the
    // project sheet, not the window.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [tooltipRef]);

  return (
    <>
      <div ref={ringRef} className="x-cursor" data-state="idle" aria-hidden>
        <span className="x-cursor__ring" />
        <span className="x-cursor__dot" />
      </div>
      {/* The gallery's "View … Project" name, filled and shown by the tooltip
          effect in PortfolioApp, positioned beside the ring by the loop above. */}
      <div
        ref={tooltipRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[201] whitespace-nowrap rounded-full bg-white/85 px-3.5 py-1.5 text-[15px] font-medium text-black shadow-lg backdrop-blur-md"
        style={{ opacity: 0, transition: "opacity 0.15s ease", willChange: "transform" }}
      />
    </>
  );
}
