"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LABELS,
  PORTFOLIO_IDS,
  type PortfolioId,
  type PortfolioItem,
} from "@/lib/portfolios";
import type { ScrollEngine } from "@/lib/ScrollEngine";
import type { ViewportState } from "@/lib/useViewport";
import LogoMark from "./LogoMark";

interface MenuProps {
  portfolio: PortfolioId;
  items: PortfolioItem[];
  isLandscape: boolean;
  viewport: ViewportState;
  engine: ScrollEngine;
  dimmed: boolean;
  intro: boolean;
  onSelectPortfolio: (id: PortfolioId) => void;
  onSelectItem: (index: number) => void;
  // Prev/next chevrons: ±1 teaser, no wheel or drag involved.
  onStepItem: (delta: number) => void;
  onOpenInfo: (kind: "resume" | "contact") => void;
  // Hovering the logo or the four pills toggles the post-process effect.
  onInfoHover: (active: boolean) => void;
}

// Half-window (in item steps) used to size the row pitch and how many copies
// of the list to render. The top/bottom dissolve is now done with static white
// gradient overlays, not per-item opacity changes.
const FADE_ZERO = 6;

/** Nearest-wrap placement of node `k` against continuous scroll `progress`. */
function place(k: number, progress: number, total: number) {
  let p = k - progress;
  p = ((p % total) + total) % total;
  if (p > total / 2) p -= total;
  return p;
}

function Pill({
  active,
  onClick,
  href,
  onHoverChange,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  href?: string;
  onHoverChange?: (active: boolean) => void;
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors min-[992px]:text-sm ${
    active
      ? "border-black bg-black text-white"
      : "border-black/30 text-black hover:border-black/70"
  }`;
  const hover = onHoverChange
    ? {
        onMouseEnter: () => onHoverChange(true),
        onMouseLeave: () => onHoverChange(false),
      }
    : undefined;
  if (href) {
    return (
      <a href={href} className={cls} {...hover}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} {...hover}>
      {children}
    </button>
  );
}

/**
 * One chevron of the list stepper. `dir` is the item delta, so -1 points up
 * (previous) and +1 down (next) — the list rides up as the index grows, which
 * matches the direction a wheel would push it.
 */
function StepButton({
  dir,
  size,
  onClick,
}: {
  dir: -1 | 1;
  size: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Distinct from the open-project nav's "Previous/Next project", which is
      // the same words for a different action.
      aria-label={dir < 0 ? "Previous teaser" : "Next teaser"}
      className="flex items-center justify-center rounded-full border border-black/30 text-black transition-colors hover:border-black hover:bg-black hover:text-white"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={dir < 0 ? { transform: "rotate(180deg)" } : undefined}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

// Roles cycled under the name. The first is repeated at the end as a clone so
// the vertical roll can loop back seamlessly (jump happens while off-screen).
const TICKER_TITLES = [
  "Creative Director",
  "Full Stack Developer",
  "Brand Visionary",
  "Illustrator",
];
const TICKER_LINE = "1.5em"; // line height of one role (em → tracks fontSize)
const TICKER_PAUSE = 2800; // ms each role rests before rolling to the next

/** Vertical role ticker shown under the name — same font/color as "Work:". */
function TitleTicker({ workSize }: { workSize: string }) {
  const [i, setI] = useState(0);
  const [animate, setAnimate] = useState(true);

  // Advance one role at a steady cadence.
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), TICKER_PAUSE);
    return () => clearInterval(id);
  }, []);

  // On reaching the appended clone of the first role, snap back to the real
  // first one without a transition, mid-pause, so the loop is invisible.
  useEffect(() => {
    if (i !== TICKER_TITLES.length) return;
    const t = setTimeout(() => {
      setAnimate(false);
      setI(0);
    }, 650);
    return () => clearTimeout(t);
  }, [i]);

  // Re-enable the transition on the next frame after a snap.
  useEffect(() => {
    if (animate) return;
    const r = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(r);
  }, [animate]);

  const list = [...TICKER_TITLES, TICKER_TITLES[0]];

  return (
    <div
      aria-hidden
      className="overflow-hidden tracking-normal text-black/60"
      style={{ fontSize: workSize, height: TICKER_LINE }}
    >
      <div
        style={{
          transform: `translateY(calc(-${TICKER_LINE} * ${i}))`,
          transition: animate
            ? "transform 0.42s cubic-bezier(0.7, 0, 0.2, 1)"
            : "none",
        }}
      >
        {list.map((title, k) => (
          <div key={k} style={{ height: TICKER_LINE, lineHeight: TICKER_LINE }}>
            {title}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Menu({
  portfolio,
  items,
  isLandscape,
  viewport,
  engine,
  dimmed,
  intro,
  onSelectPortfolio,
  onSelectItem,
  onStepItem,
  onOpenInfo,
  onInfoHover,
}: MenuProps) {
  const hoverFx = {
    onMouseEnter: () => onInfoHover(true),
    onMouseLeave: () => onInfoHover(false),
  };
  const isLarge = viewport.width >= 992;
  const isMedium = viewport.width >= 768;
  const fontSize = isLarge ? 18 : isMedium ? 16 : 14;
  const baseRow = Math.round(fontSize * 1.95);
  // Vertical breathing space added to each row's measured (possibly wrapped)
  // height in portrait, so multi-line items still separate cleanly.
  const ROW_GAP = Math.round(fontSize * 0.6);

  // Landscape: the brand block floats over the top of the full-height list, so
  // the items' true region is the space *below* it. Measure that overlay and
  // center the list within the remaining area, so the active item sits dead-
  // center of the visible region rather than the whole panel. Portrait stacks
  // the brand beside the list, so its full-height center is already correct.
  const brandBoxRef = useRef<HTMLDivElement>(null);
  const [brandH, setBrandH] = useState(0);
  useEffect(() => {
    if (!isLandscape) {
      setBrandH(0);
      return;
    }
    const el = brandBoxRef.current;
    if (!el) return;
    const measure = () => setBrandH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLandscape, viewport.width, viewport.height]);

  // Landscape also docks the Resumé/Contact links in a bar across the bottom;
  // measure it the same way so the list region sits between the two.
  const linksBoxRef = useRef<HTMLDivElement>(null);
  const [linksH, setLinksH] = useState(0);
  useEffect(() => {
    if (!isLandscape) {
      setLinksH(0);
      return;
    }
    const el = linksBoxRef.current;
    if (!el) return;
    const measure = () => setLinksH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLandscape, viewport.width, viewport.height]);

  // The region is the space between the brand box (top) and the links bar
  // (bottom); the list centers in it and dissolves symmetrically.
  const regionTop = isLandscape ? brandH : 0;
  const regionBottom = isLandscape ? linksH : 0;
  const regionHeight = Math.max(
    baseRow * 2,
    viewport.height - regionTop - regionBottom
  );
  const centerY = regionTop + regionHeight / 2;
  // Space rows so the fade-out radius (FADE_ZERO steps) lands at the region
  // edges. Portrait keeps the tight text-based spacing.
  const rowHeight = isLandscape
    ? Math.max(baseRow, Math.round(regionHeight / 2 / FADE_ZERO))
    : baseRow;
  // Active item (p=0) sits at the region center in landscape, panel center in
  // portrait.
  const listTop = isLandscape ? `${centerY}px` : "50%";
  const listPadLeft = isLandscape ? (isLarge ? 28 : 20) : 8;
  // Prev/next chevrons dock at the list's right edge, centred on the active
  // row. Rows reserve `chevGutter` on that side so a wrapped title can never
  // run underneath them — in portrait the list column is only half the panel,
  // so there isn't room to let the two overlap.
  const chevSize = isLarge ? 34 : 30;
  const chevInset = isLandscape ? (isLarge ? 14 : 10) : 6;
  const chevGutter = chevSize + chevInset + 8;

  const n = items.length;
  // Repeat the list enough that the wrap seam sits past the fade-out radius,
  // so items dissolve before they'd ever jump from one end to the other.
  const reps = Math.max(1, Math.ceil((2 * FADE_ZERO + 1) / n));
  const total = reps * n;
  const nodes = useMemo(
    () => Array.from({ length: total }, (_, k) => ({ key: k, item: k % n })),
    [total, n]
  );

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Drive placement/opacity from the shared scroll engine every frame — the
  // same source the WebGL gallery reads, so menu and gallery stay locked,
  // snap together, and the active item settles dead-center. Always vertical,
  // regardless of orientation.
  //
  // Titles may wrap to multiple lines in either orientation, so rows have
  // *different* heights: we measure each unique item's rendered height and
  // stack the strip by those cumulative heights (with infinite wrap), instead
  // of a constant pitch. Landscape keeps its airy spread by enforcing the
  // orientation row pitch as a minimum advance; portrait stays text-tight.
  useEffect(() => {
    let raf = 0;
    const N = n;
    if (N === 0) return;
    const heights = new Array(N).fill(baseRow); // measured row heights (px)
    const advance = new Array(N).fill(baseRow); // height + the shared gap
    const prefix = new Array(N + 1).fill(0); // prefix sums of `advance`
    const mod = (a: number, b: number) => ((a % b) + b) % b;

    // Heights are pushed in by the observer rather than read every frame. Two
    // reasons: N layout reads a frame is the most expensive thing this loop
    // did, and a re-read that's gated on "has anything moved" can go stale
    // exactly when it matters — a row rewrapping while the list sits still.
    let lastCurrent = NaN;
    let dirty = true;
    const indexOf = new Map<Element, number>();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const i = indexOf.get(e.target);
        if (i === undefined) continue;
        const h = e.contentRect.height || baseRow;
        if (h !== heights[i]) {
          heights[i] = h;
          dirty = true;
        }
      }
    });
    for (let i = 0; i < N; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      indexOf.set(el, i);
      heights[i] = el.offsetHeight || baseRow; // seed before the first frame
      ro.observe(el);
    }

    /**
     * One gap between every pair of rows, whatever their line count. The old
     * rule took `max(pitch, height + gap)`, so a single-line row was spaced by
     * the pitch and a wrapped one by its own height — visibly different gaps
     * either side of any title that wrapped. Deriving the gap from the
     * shortest row keeps landscape's airy rhythm for single-line rows while a
     * wrapped row simply takes the extra height it needs.
     */
    const relayout = () => {
      const shortest = Math.min(...heights);
      const gap = isLandscape
        ? Math.max(ROW_GAP, rowHeight - shortest)
        : ROW_GAP;
      let H = 0;
      for (let i = 0; i < N; i++) advance[i] = heights[i] + gap;
      for (let i = 0; i < N; i++) {
        prefix[i] = H;
        H += advance[i];
      }
      prefix[N] = H;
      return H;
    };
    let total_H = relayout();

    const tick = () => {
      const spacing = engine.spacing || 1;
      const progress = engine.current / spacing;
      if (engine.current === lastCurrent && !dirty) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastCurrent = engine.current;
      if (dirty) {
        total_H = relayout();
        dirty = false;
      }
      const H = total_H;
      const ET = reps * H; // wrap period in px (matches the node strip length)

      // Pixel scroll position that should sit at the viewport center. At an
      // integer progress the active item is centered; between two items it
      // interpolates by their half-heights so the motion stays smooth.
      const iI = Math.floor(progress);
      const frac = progress - iI;
      const hI = advance[mod(iI, N)];
      const hI1 = advance[mod(iI + 1, N)];
      const cumCenterI = Math.floor(iI / N) * H + prefix[mod(iI, N)] + hI / 2;
      const S = mod(cumCenterI + frac * (hI / 2 + hI1 / 2), ET);

      for (let k = 0; k < total; k++) {
        const el = rowRefs.current[k];
        if (!el) continue;
        // Linear center of this node, then nearest wrapped copy around S.
        const Lk = Math.floor(k / N) * H + prefix[k % N] + advance[k % N] / 2;
        const pPx = mod(Lk - S + ET / 2, ET) - ET / 2;
        // Fade/underline stay keyed to item-step distance (consistent count
        // of visible items), independent of the variable pixel spacing.
        const stepP = place(k, progress, total);
        el.style.transform = `translateY(calc(-50% + ${pPx}px))`;
        el.style.pointerEvents = Math.abs(stepP) > FADE_ZERO * 0.7 ? "none" : "auto";
        const title = titleRefs.current[k];
        if (title)
          title.style.textDecoration = Math.abs(stepP) < 0.5 ? "underline" : "none";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine, total, rowHeight, isLandscape, n, reps, baseRow, ROW_GAP]);

  // Initial inline placement so the first paint is already positioned.
  const progress0 = engine.current / (engine.spacing || 1);

  // Fluid sizes (clamp) scale continuously with the viewport so the brand
  // block stays proportioned instead of jumping at one breakpoint.
  const logoWidth = isLandscape
    ? isMedium ? "clamp(100px, 9vw, 160px)" : "clamp(72px, 7vw, 120px)"
    : isMedium ? "clamp(96px, 14vw, 140px)" : "clamp(72px, 15vw, 116px)";
  const nameSize = isLandscape
    ? isLarge ? "clamp(18px, 1.8vw, 28px)" : isMedium ? "clamp(15px, 1.6vw, 20px)" : "clamp(13px, 1.35vw, 18px)"
    : isMedium ? "clamp(16px, 3vw, 22px)" : "clamp(15px, 3vw, 19px)";
  const workSize = "clamp(11px, 1.05vw, 13px)";

  const introAnim = (delay: number): React.CSSProperties => ({
    opacity: intro ? 1 : 0,
    transform: intro ? "none" : "translateY(10px)",
    transition: `opacity 0.38s ease ${delay}ms, transform 0.38s ease ${delay}ms`,
  });

  // Resumé / Contact links. Portrait shows them inside the brand (below a
  // divider); landscape docks them in a bar across the bottom of the rail.
  const links = (
    <div className="flex flex-wrap items-center gap-2">
      <Pill onClick={() => onOpenInfo("resume")} onHoverChange={onInfoHover}>
        Resumé
      </Pill>
      <Pill onClick={() => onOpenInfo("contact")} onHoverChange={onInfoHover}>
        Contact
      </Pill>
    </div>
  );

  // Content is always left-aligned. The portrait column (flex justify-center)
  // centers this whole block horizontally when it's narrower than the column;
  // nothing inside is ever center-aligned. Landscape docks it at top-left.
  const brand = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <div style={introAnim(0)}>
          <span className="inline-block" {...hoverFx}>
            <LogoMark
              className="h-auto shrink-0 text-black"
              style={{ width: logoWidth }}
            />
          </span>
        </div>
        <div className="pt-2 md:pt-5 leading-tight tracking-tighter" style={introAnim(160)}>
          <div className="font-medium" style={{ fontSize: nameSize }}>
            Andy Weitzel
          </div>
          <div className="mt-1.5">
            <TitleTicker workSize={workSize} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2" style={introAnim(300)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-black/60" style={{ fontSize: workSize }}>
            Work:
          </span>
          {PORTFOLIO_IDS.map((id) => (
            <Pill
              key={id}
              active={portfolio === id}
              onClick={() => onSelectPortfolio(id)}
              onHoverChange={onInfoHover}
            >
              {LABELS[id]}
            </Pill>
          ))}
        </div>
        {/* Portrait: links sit here under a grey divider. Landscape moves them
            to the bottom bar (rendered separately). */}
        {!isLandscape && (
          <>
            <div className="mt-1 h-px w-full bg-black/15" />
            {links}
          </>
        )}
      </div>
    </div>
  );

  const listStrip = nodes.map((node) => {
    const p = place(node.key, progress0, total);
    return (
      <button
        key={node.key}
        ref={(el) => void (rowRefs.current[node.key] = el)}
        type="button"
        onClick={() => onSelectItem(node.item)}
        className="absolute flex items-baseline gap-2.5 whitespace-normal text-left font-medium"
        style={{
          top: listTop,
          // Rows span the column width and wrap within it (portrait); text stays
          // left-aligned, so titles fill the column instead of being padded.
          left: isLandscape ? listPadLeft : 12,
          right: chevGutter,
          fontSize,
          transform: `translateY(calc(-50% + ${p * rowHeight}px))`,
          willChange: "transform",
        }}
      >
        <span
          className="font-index shrink-0 tabular-nums text-black/50"
          style={{ width: fontSize * 1.4, fontSize: fontSize * 0.62 }}
        >
          {String(node.item + 1).padStart(2, "0")}
        </span>
        <span
          ref={(el) => void (titleRefs.current[node.key] = el)}
          className="min-w-0 break-words"
          style={{
            textUnderlineOffset: 4,
            textDecoration: Math.abs(p) < 0.5 ? "underline" : "none",
          }}
        >
          {items[node.item].title}
        </span>
      </button>
    );
  });

  // Static white gradient masks dissolve the list at the top/bottom (replacing
  // the old per-item opacity). pointer-events-none so list clicks pass through.
  const topMask = (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-white via-white/80 to-transparent"
      style={{ height: "42%" }}
    />
  );
  const bottomMask = (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-white via-white/80 to-transparent"
      style={{ height: "42%" }}
    />
  );
  const listFade: React.CSSProperties = {
    opacity: dimmed ? 0 : intro ? 1 : 0,
    transition: intro ? "opacity 0.15s ease" : "opacity 0.38s ease 300ms",
  };
  // Landscape: top and bottom fades share this height so the list dissolves
  // symmetrically about its center (the brand box covers everything above the
  // top fade). 0.42 of the region leaves a centered clear band.
  const fadeH = Math.round(regionHeight * 0.42);

  // Fades in and out with the list it drives; explicitly un-clickable while
  // faded, since opacity alone would leave invisible hit targets during a
  // portfolio switch.
  const stepper = (
    <div
      className="absolute z-20 flex flex-col"
      style={{
        right: chevInset,
        top: isLandscape ? centerY : "50%",
        transform: "translateY(-50%)",
        gap: Math.round(chevSize * 0.3),
        ...listFade,
        pointerEvents: dimmed || !intro ? "none" : "auto",
      }}
    >
      <StepButton dir={-1} size={chevSize} onClick={() => onStepItem(-1)} />
      <StepButton dir={1} size={chevSize} onClick={() => onStepItem(1)} />
    </div>
  );

  return (
    <aside data-menu className="h-full w-full bg-white text-black">
      {isLandscape ? (
        // Single column: list fills the whole panel. The brand floats over the
        // top on an opaque white box (masking the top), and a bottom gradient
        // dissolves the tail.
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute inset-0" style={listFade}>
            {listStrip}
          </div>
          {stepper}
          <div
            className="pointer-events-none absolute inset-x-0 z-10 bg-gradient-to-t from-white via-white/80 to-transparent"
            style={{ bottom: linksH, height: fadeH }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <div ref={brandBoxRef} className="pointer-events-auto bg-white p-5 min-[992px]:p-7">{brand}</div>
            <div
              className="bg-gradient-to-b from-white via-white/80 to-transparent"
              style={{ height: fadeH }}
            />
          </div>
          {/* Resumé / Contact docked across the bottom of the rail, left-aligned. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
            <div
              ref={linksBoxRef}
              className="pointer-events-auto bg-white px-5 pb-5 pt-3 min-[992px]:px-7 min-[992px]:pb-7"
              style={introAnim(300)}
            >
              {links}
            </div>
          </div>
        </div>
      ) : (
        // Two equal columns: brand/links and the menu list. Each column centers
        // its content block horizontally (flex), content stays left-aligned.
        // The list column's width is what makes long titles wrap.
        <div className="flex h-full w-full">
          <div
            className="flex w-1/2 shrink-0 items-center justify-center px-2"
            style={{ paddingLeft: viewport.width < 450 ? 18 : undefined }}
          >
            {brand}
          </div>
          <div className="relative h-full w-1/2 overflow-hidden">
            <div className="absolute inset-0" style={listFade}>
              {listStrip}
            </div>
            {topMask}
            {bottomMask}
            {stepper}
          </div>
        </div>
      )}
    </aside>
  );
}
