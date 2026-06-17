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
}

// Half-window (in item steps) used to size the row pitch and how many copies
// of the list to render. The top/bottom dissolve is now done with static white
// gradient overlays, not per-item opacity changes.
const FADE_ZERO = 6;

const CONTACT_HREF = "mailto:andy@box.biz";
const RESUME_HREF = "/resume.pdf"; // TODO: drop the actual résumé PDF in /public

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
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors min-[992px]:text-sm ${
    active
      ? "border-black bg-black text-white"
      : "border-black/30 text-black hover:border-black/70"
  }`;
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

// Roles cycled under the name. The first is repeated at the end as a clone so
// the vertical roll can loop back seamlessly (jump happens while off-screen).
const TICKER_TITLES = [
  "Creative Director",
  "Marketing Director",
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
            ? "transform 0.6s cubic-bezier(0.7, 0, 0.2, 1)"
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
}: MenuProps) {
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

  // The region starts right at the brand box bottom, so the top list items
  // render *behind* the gradient strip and dissolve under it — rather than
  // beginning below the gradient, which would leave an empty gap.
  const regionTop = isLandscape ? brandH : 0;
  const regionHeight = Math.max(baseRow * 2, viewport.height - regionTop);
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
  // Landscape uses a fixed row pitch (titles never wrap in the rail). Portrait
  // lets titles wrap to multiple lines, so rows have *different* heights: we
  // measure each unique item's rendered height and stack the strip by those
  // cumulative heights (with infinite wrap), instead of a constant pitch.
  useEffect(() => {
    let raf = 0;
    const N = n;
    const heights = new Array(N).fill(baseRow); // per-item advance (px)
    const prefix = new Array(N + 1).fill(0); // prefix sums of `heights`
    const mod = (a: number, b: number) => ((a % b) + b) % b;

    const tick = () => {
      const spacing = engine.spacing || 1;
      const progress = engine.current / spacing;

      if (!isLandscape && N > 0) {
        // Measure each unique item's wrapped height. Reading offsetHeight here
        // is cheap: only transforms/opacity changed since the last layout, and
        // neither dirties layout, so this doesn't force a reflow.
        let H = 0;
        for (let i = 0; i < N; i++) {
          const el = rowRefs.current[i];
          const h = el ? el.offsetHeight : 0;
          heights[i] = (h > 0 ? h : baseRow) + ROW_GAP;
        }
        for (let i = 0; i < N; i++) {
          prefix[i] = H;
          H += heights[i];
        }
        prefix[N] = H;
        const ET = reps * H; // wrap period in px (matches the node strip length)

        // Pixel scroll position that should sit at the viewport center. At an
        // integer progress the active item is centered; between two items it
        // interpolates by their half-heights so the motion stays smooth.
        const iI = Math.floor(progress);
        const frac = progress - iI;
        const hI = heights[mod(iI, N)];
        const hI1 = heights[mod(iI + 1, N)];
        const cumCenterI = Math.floor(iI / N) * H + prefix[mod(iI, N)] + hI / 2;
        const S = mod(cumCenterI + frac * (hI / 2 + hI1 / 2), ET);

        for (let k = 0; k < total; k++) {
          const el = rowRefs.current[k];
          if (!el) continue;
          // Linear center of this node, then nearest wrapped copy around S.
          const Lk = Math.floor(k / N) * H + prefix[k % N] + heights[k % N] / 2;
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
      } else {
        for (let k = 0; k < total; k++) {
          const el = rowRefs.current[k];
          if (!el) continue;
          const p = place(k, progress, total);
          el.style.transform = `translateY(calc(-50% + ${p * rowHeight}px))`;
          el.style.pointerEvents = Math.abs(p) > FADE_ZERO * 0.7 ? "none" : "auto";
          const title = titleRefs.current[k];
          // The centered item (|p| < 0.5) is the active one — underline it.
          if (title) title.style.textDecoration = Math.abs(p) < 0.5 ? "underline" : "none";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
    transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
  });

  // Content is always left-aligned. The portrait column (flex justify-center)
  // centers this whole block horizontally when it's narrower than the column;
  // nothing inside is ever center-aligned. Landscape docks it at top-left.
  const brand = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <div style={introAnim(0)}>
          <LogoMark
            className="h-auto shrink-0 text-black"
            style={{ width: logoWidth }}
          />
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
            >
              {LABELS[id]}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill href={RESUME_HREF}>Resumé</Pill>
          <Pill href={CONTACT_HREF}>Contact</Pill>
        </div>
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
        className={`absolute flex items-baseline gap-2.5 text-left font-medium ${
          isLandscape ? "whitespace-nowrap" : "whitespace-normal"
        }`}
        style={{
          top: listTop,
          // Rows span the column width and wrap within it (portrait); text stays
          // left-aligned, so titles fill the column instead of being padded.
          left: isLandscape ? listPadLeft : 12,
          right: 12,
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
      className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-white to-transparent"
      style={{ height: "28%" }}
    />
  );
  const bottomMask = (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-white to-transparent"
      style={{ height: "28%" }}
    />
  );
  const listFade: React.CSSProperties = {
    opacity: dimmed ? 0 : intro ? 1 : 0,
    transition: intro ? "opacity 0.22s ease" : "opacity 0.55s ease 440ms",
  };

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
          {bottomMask}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <div ref={brandBoxRef} className="pointer-events-auto bg-white p-5 min-[992px]:p-7">{brand}</div>
            <div className="h-10 bg-gradient-to-b from-white to-transparent" />
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
          </div>
        </div>
      )}
    </aside>
  );
}
