"use client";

import { useEffect, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";

// One line, looping forever. Duplicated in the track so the -50% translate
// wraps seamlessly (see the marquee-x keyframes in globals.css).
const TICKER =
  "Andy is a Creative Director / CCO, Marketing Director, illustrator, visual artist, and full-stack technologist with over two decades of experience at the intersection of design, brand-building, and emerging technology.";

// The line holds still on arrival, then starts crawling — so the sentence is
// readable from the top before it moves.
const TICKER_START_DELAY = 2000;

// Shared by the wordmark and the logo, so the logo is exactly as tall as the
// name's line box (the h1 is leading-none, so its box equals the font size).
const NAME_SIZE = "clamp(34px, 6vw, 86px)";
// Body copy size, used for the ticker and everything under the divider.
const COPY_SIZE = "clamp(15px, 1.5vw, 20px)";

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
  const [ticking, setTicking] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTicking(true), TICKER_START_DELAY);
    return () => clearTimeout(t);
  }, []);

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
      {/* Wordmark with the logo beside it at matching height; stacks (logo on
          top) below the sm breakpoint. */}
      <div className="flex flex-col items-start gap-4 px-6 sm:flex-row sm:items-center sm:gap-6 sm:px-10">
        <LogoMark
          className="shrink-0 text-black sm:order-last"
          style={{ height: NAME_SIZE, width: "auto" }}
        />
        <h1
          className="font-medium leading-none tracking-tighter"
          style={{ fontSize: NAME_SIZE }}
        >
          Andy Weitzel
        </h1>
      </div>

      {/* Full-bleed single-line ticker — no side padding, so it runs edge to
          edge while everything else stays on the left margin. */}
      <div className="mt-5 w-full overflow-hidden" aria-label={TICKER}>
        <h3
          aria-hidden
          className="inline-flex whitespace-nowrap text-black"
          style={{
            fontSize: COPY_SIZE,
            animation: "marquee-x 38s linear infinite",
            animationPlayState: ticking ? "running" : "paused",
            willChange: "transform",
          }}
        >
          <span className="pr-16">{TICKER}</span>
          <span className="pr-16">{TICKER}</span>
        </h3>
      </div>

      {/* Full-bleed rule dividing the branding block from the portfolio picker. */}
      <div className="mt-4 h-px w-full bg-black" />

      <p className="mt-8 px-6 font-medium sm:px-10" style={{ fontSize: COPY_SIZE }}>
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
            <p className="text-sm text-black min-[992px]:text-base">{BLURBS[id]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
