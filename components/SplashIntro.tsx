"use client";

import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";

// One line, looping forever. Duplicated in the track so the -50% translate
// wraps seamlessly (see the marquee-x keyframes in globals.css).
const TICKER =
  "Andy is a Creative Director / CCO, Marketing Director, illustrator, visual artist, and full-stack technologist with over two decades of experience at the intersection of design, brand-building, and emerging technology.";

// What each portfolio actually covers, shown beside its button.
const BLURBS: Record<PortfolioId, string> = {
  interactive: "UX design and dev",
  branding: "Logo + print design",
  richmedia: "Rich media ad design and dev",
};

/**
 * Full-page white gate shown before the gallery intro. The visitor picks
 * which portfolio to start in; the parent sets that portfolio, fades this
 * out, and only then runs the slide-in reveal.
 */
export default function SplashIntro({
  onChoose,
  hiding,
  height,
}: {
  onChoose: (id: PortfolioId) => void;
  // Parent flips this to fade the overlay out before unmounting it.
  hiding: boolean;
  // Real pixel height (never 100vh — mobile browser chrome makes that wrong).
  height: number;
}) {
  return (
    <div
      data-splash
      className="fixed inset-x-0 top-0 z-[80] flex w-full flex-col justify-center overflow-hidden bg-white text-black"
      style={{
        height,
        opacity: hiding ? 0 : 1,
        pointerEvents: hiding ? "none" : "auto",
        transition: "opacity 0.6s ease",
      }}
    >
      <LogoMark
        className="h-auto shrink-0 px-6 text-black sm:px-10"
        style={{ width: "clamp(96px, 12vw, 190px)" }}
      />

      <h1
        className="mt-6 px-6 font-medium leading-none tracking-tighter sm:px-10"
        style={{ fontSize: "clamp(34px, 6vw, 86px)" }}
      >
        Andy Weitzel
      </h1>

      {/* Full-bleed single-line ticker — no side padding, so it runs edge to
          edge while everything else stays on the left margin. */}
      <div className="mt-5 w-full overflow-hidden" aria-label={TICKER}>
        <h3
          aria-hidden
          className="inline-flex whitespace-nowrap text-black/60"
          style={{
            fontSize: "clamp(14px, 1.7vw, 24px)",
            animation: "marquee-x 44s linear infinite",
            willChange: "transform",
          }}
        >
          <span className="pr-16">{TICKER}</span>
          <span className="pr-16">{TICKER}</span>
        </h3>
      </div>

      <p
        className="mt-12 px-6 font-medium sm:px-10"
        style={{ fontSize: "clamp(15px, 1.5vw, 20px)" }}
      >
        Which portfolio would you like to start with?
      </p>

      <div className="mt-5 flex flex-col items-start gap-3 px-6 sm:px-10">
        {PORTFOLIO_IDS.map((id) => (
          <div key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => onChoose(id)}
              className="inline-flex shrink-0 items-center rounded-full border border-black px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white min-[992px]:text-base"
            >
              {LABELS[id]}
            </button>
            <p className="text-sm text-black/60 min-[992px]:text-base">{BLURBS[id]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
