"use client";

import { useEffect, useRef } from "react";
import type { PortfolioItem } from "@/lib/portfolios";
import { GRID_LABEL_LEADING, type GridLabelLayout } from "./Gallery";

/**
 * The project names under the teasers, while the gallery is in grid form.
 *
 * DOM, not geometry. The canvas has carried no text since the titles came
 * out of it — a wrapped, clamped line of type at a dozen pixels is something
 * the browser does for nothing and three.js does with a font payload, a
 * geometry per title and no wrapping at all. The scene publishes where each
 * label goes (`GridLabelLayout`, in screen px inside the canvas box) and
 * this reads it on its own rAF, so a title tracks its teaser through the
 * morph, the reflow and the scroll without React re-rendering once.
 *
 * Mounted only while there is a grid, so the loop is not running the rest of
 * the time; the parent keeps it alive a beat past closing so the labels can
 * go out with the teasers.
 */
export default function GridLabels({
  items,
  layout,
}: {
  items: PortfolioItem[];
  layout: React.MutableRefObject<GridLabelLayout | null>;
}) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const L = layout.current;
      if (L) {
        for (let i = 0; i < items.length; i++) {
          const el = refs.current[i];
          if (!el) continue;
          const a = L.live ? L.a[i] : 0;
          if (a <= 0.004) {
            if (el.style.visibility !== "hidden")
              el.style.visibility = "hidden";
            continue;
          }
          el.style.visibility = "visible";
          el.style.opacity = String(a);
          el.style.width = `${L.width}px`;
          el.style.fontSize = `${L.font}px`;
          el.style.transform = `translate3d(${L.x[i]}px, ${L.y[i]}px, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [items.length, layout]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((item, i) => (
        <div
          key={item.id}
          ref={(el) => void (refs.current[i] = el)}
          // Clamped to two lines, which is what the grid reserves for it:
          // a third line would walk into the row below and the rhythm of
          // the grid is most of what makes it readable.
          className="absolute left-0 top-0 line-clamp-2 font-medium text-white/85"
          // The leading is shared with the band the grid reserves for this,
          // so the two can never disagree about how tall two lines are.
          style={{
            visibility: "hidden",
            willChange: "transform",
            lineHeight: GRID_LABEL_LEADING,
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}
