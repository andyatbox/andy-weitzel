"use client";

import { useEffect, useState, type RefObject } from "react";

interface ScrollHintProps {
  /** The project sheet's scroll container. */
  scrollRef: RefObject<HTMLElement | null>;
  /**
   * The sheet's content. Watched rather than measured once: the body arrives
   * from Sanity after the sheet mounts and its images settle later still, so
   * whether there is anything to scroll isn't known at mount.
   */
  contentRef: RefObject<HTMLElement | null>;
  height: number;
  /** The sheet is up and nothing is covering it. */
  active: boolean;
}

// How far down the sheet counts as "scrolled" and retires the hint. Far
// enough that a trackpad twitch doesn't dismiss it, near enough that one
// wheel notch does.
const DISMISS_PX = 40;
// The hint is vertically centred and runs ~160px tall, and the back/portfolio
// nav stack occupies the top ~150px of the same edge. Below this the two
// would meet, so the hint stands down instead. Measured height, never 100vh.
const MIN_HEIGHT = 520;

/**
 * "SCROLL" and a long arrow, turned a quarter turn so it reads down the left
 * edge of an open project. Desktop only, and only until the reader has taken
 * the hint.
 */
export default function ScrollHint({
  scrollRef,
  contentRef,
  height,
  active,
}: ScrollHintProps) {
  const [atTop, setAtTop] = useState(true);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const read = () => {
      setAtTop(el.scrollTop <= DISMISS_PX);
      setScrollable(el.scrollHeight - el.clientHeight > DISMISS_PX);
    };
    read();

    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(content);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [scrollRef, contentRef, active]);

  const show = active && atTop && scrollable && height >= MIN_HEIGHT;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 z-10 hidden w-16 -translate-y-1/2 justify-center text-black/70 md:flex"
      style={{
        top: height / 2,
        opacity: show ? 1 : 0,
        transition: "opacity 0.5s ease",
      }}
    >
      {/* Rotated clockwise: the label reads downward and the arrow, drawn
          pointing right, points down the page. Rotation doesn't affect
          layout, so the row's real width becomes its apparent height and
          only its ~12px height has to fit the column above. */}
      <div className="flex rotate-90 items-center gap-3 whitespace-nowrap">
        <span className="font-label text-[11px] uppercase tracking-[0.3em]">
          Scroll
        </span>
        <svg
          width="90"
          height="12"
          viewBox="0 0 90 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Shaft and head move as one — see scroll-hint-run in globals.css.
              The viewBox is wider than the arrow to leave room for that
              travel; SVG clips at its own edge. */}
          <g className="scroll-hint-run">
            <path d="M8 6h66" />
            <path d="M68 1l6 5-6 5" />
          </g>
        </svg>
      </div>
    </div>
  );
}
