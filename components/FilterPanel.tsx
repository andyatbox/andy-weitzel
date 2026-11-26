"use client";

import Pill from "./Pill";
import { tagLabel } from "@/lib/tags";

/**
 * What takes the rail's place while the gallery is in grid form: a header
 * carrying the close X at the left and Reset at the right, then every tag the
 * portfolio in front of you actually carries, as pills.
 *
 * It is laid out by the menu rather than by itself — the pill sizes and the
 * left padding are passed in — because the two panels occupy the same
 * rectangle half a second apart, and anything measured twice drifts.
 *
 * The header is outside the scroll on purpose. With the two controls at the
 * end of the tag row, which is where they started, a dozen-odd tags pushed
 * them off the bottom of every phone: measured at 892px in an 844px window.
 *
 * `data-filter-scroll` marks the scrolling area: the app swallows wheels and
 * drags at the window to drive the gallery, so it has to be told where one
 * belongs to the page instead.
 */
export default function FilterPanel({
  tags,
  selected,
  onToggle,
  onReset,
  onClose,
  pillSize,
  pillPad,
  padLeft,
  closeSize,
}: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  onReset: () => void;
  onClose: () => void;
  pillSize: number;
  pillPad?: [number, number];
  padLeft: number;
  closeSize: number;
}) {
  const pad = pillPad ?? [
    Math.round(pillSize * 0.42),
    Math.round(pillSize * 0.95),
  ];
  return (
    <div
      className="flex h-full w-full flex-col bg-black p-5 min-[992px]:p-7"
      style={{ paddingLeft: padLeft }}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="flex shrink-0 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:border-white hover:bg-white hover:text-black"
          style={{ width: closeSize, height: closeSize }}
        >
          <svg
            width={Math.round(closeSize * 0.42)}
            height={Math.round(closeSize * 0.42)}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
        {/* Dimmed rather than hidden when nothing is on: a control that comes
            and goes moves the header under the pointer that is about to use
            it. */}
        <button
          type="button"
          onClick={onReset}
          disabled={selected.length === 0}
          className="inline-flex items-center rounded-full border border-white/30 font-medium text-white transition-colors hover:border-white/70 disabled:pointer-events-none disabled:opacity-35"
          style={{ fontSize: pillSize, padding: `${pad[0]}px ${pad[1]}px` }}
        >
          Reset
        </button>
      </div>

      <div
        data-filter-scroll
        className="min-h-0 overflow-y-auto overscroll-contain"
      >
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <Pill
              key={tag}
              active={selected.includes(tag)}
              ariaPressed={selected.includes(tag)}
              onClick={() => onToggle(tag)}
              size={pillSize}
              pad={pillPad}
            >
              {tagLabel(tag)}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}
