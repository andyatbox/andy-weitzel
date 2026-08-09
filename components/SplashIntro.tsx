"use client";

import { useEffect, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";

// One line, looping forever. Duplicated in the track so the -50% translate
// wraps seamlessly (see the marquee-x keyframes in globals.css).
const TICKER =
  "Andy is a Creative Director / CCO, Marketing Director, illustrator, visual artist, and full-stack technologist with over two decades of experience at the intersection of design, brand-building, and emerging technology.";

// Staggered reveal: each element slides up and fades in, one after the next.
const REVEAL_STEP = 120; // ms between elements
const REVEAL_DUR = 550; // ms per element
const REVEAL_STEPS = 7; // lockup, ticker, rule, question, pills, rule, links
// The ticker holds still until the reveal has finished and settled, so the
// sentence is readable from its start before it begins crawling.
const TICKER_START_DELAY = 3000;
const REVEAL_TOTAL = (REVEAL_STEPS - 1) * REVEAL_STEP + REVEAL_DUR;
// Don't wait on webfonts forever if they fail or stall — reveal regardless.
const FONT_WAIT_CAP = 2000;

const NAME_SIZE = "clamp(34px, 6vw, 86px)";
// New Spirit Medium's cap height as a fraction of font size, measured from the
// rendered face (canvas actualBoundingBoxAscent of "A" ÷ font size). The logo
// is an all-caps monogram, so sizing it to cap height — and baseline-aligning
// it — makes it read as the same size as the wordmark's capitals.
const CAP_RATIO = 0.717;
const LOGO_SIZE = `calc(${NAME_SIZE} * ${CAP_RATIO})`;
// Body copy size, used for the ticker and everything under the divider.
const COPY_SIZE = "clamp(15px, 1.5vw, 20px)";

// Shared pill: portfolio picker and the Resumé / Contact links.
const PILL =
  "inline-flex shrink-0 items-center rounded-full border border-black px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white min-[992px]:text-base";

// Splash-only labels. With the descriptions gone the button alone has to say
// what the portfolio is, so Interactive gets its full name here; the menu and
// the project nav keep the short label, where pill width is tight.
const SPLASH_LABELS: Record<PortfolioId, string> = {
  ...LABELS,
  interactive: "Interactive Experiences",
};

/**
 * Full-page white gate shown before the gallery intro. The visitor picks
 * which portfolio to start in; the parent sets that portfolio, fades this
 * out, and only then runs the slide-in reveal. Resumé/Contact are repeated
 * here so they're reachable before the gallery exists.
 */
export default function SplashIntro({
  onChoose,
  onOpenInfo,
  hiding,
  height,
}: {
  onChoose: (id: PortfolioId) => void;
  onOpenInfo: (kind: "resume" | "contact") => void;
  // Parent flips this to fade the overlay out before unmounting it.
  hiding: boolean;
  // Real pixel height (never 100vh — mobile browser chrome makes that wrong).
  height: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const [ticking, setTicking] = useState(false);

  // Hold everything hidden until the webfonts have settled, then run the
  // stagger. Revealing earlier means watching the copy reflow from the
  // fallback face into New Spirit, which is the ugly part.
  useEffect(() => {
    let alive = true;
    let tickerTimer: ReturnType<typeof setTimeout>;
    const start = () => {
      if (!alive) return;
      setRevealed(true);
      tickerTimer = setTimeout(() => {
        if (alive) setTicking(true);
      }, REVEAL_TOTAL + TICKER_START_DELAY);
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void Promise.race([
      fonts,
      new Promise((res) => setTimeout(res, FONT_WAIT_CAP)),
    ]).then(start);
    return () => {
      alive = false;
      clearTimeout(tickerTimer);
    };
  }, []);

  // Slide-fade for the nth element in the sequence.
  const step = (i: number): React.CSSProperties => ({
    opacity: revealed ? 1 : 0,
    transform: revealed ? "none" : "translateY(14px)",
    transition: `opacity ${REVEAL_DUR}ms ease ${i * REVEAL_STEP}ms, transform ${REVEAL_DUR}ms ease ${i * REVEAL_STEP}ms`,
  });

  return (
    <div
      data-splash
      className="fixed inset-x-0 top-0 isolate z-[80] flex w-full flex-col justify-center overflow-hidden bg-white text-black"
      style={{
        height,
        opacity: hiding ? 0 : 1,
        pointerEvents: hiding ? "none" : "auto",
        transition: "opacity 0.6s ease",
      }}
    >
      {/* Wordmark left, logo pushed to the page's right gutter and sitting on
          the wordmark's baseline. Stacks (logo on top, left-aligned) below the
          sm breakpoint. Baseline alignment works because an SVG is a replaced
          element, so its baseline is its bottom edge. */}
      <div
        className="flex flex-col items-start gap-4 px-6 sm:flex-row sm:items-baseline sm:gap-6 sm:px-10"
        style={step(0)}
      >
        <LogoMark
          className="shrink-0 text-black sm:order-last sm:ml-auto"
          style={{ height: LOGO_SIZE, width: "auto" }}
        />
        <h1
          className="font-medium leading-none tracking-tighter"
          style={{ fontSize: NAME_SIZE }}
        >
          Andy Weitzel
        </h1>
      </div>

      {/* Single-line ticker, inset to the same gutter as everything else so it
          starts on the shared left margin (the divider below stays full-bleed). */}
      <div
        className="mt-5 w-full overflow-hidden px-6 sm:px-10"
        aria-label={TICKER}
        style={step(1)}
      >
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
      <div className="mt-4 h-px w-full bg-black" style={step(2)} />

      <p
        className="mt-8 px-6 font-medium sm:px-10"
        style={{ fontSize: COPY_SIZE, ...step(3) }}
      >
        Which portfolio would you like to start with?
      </p>

      <div
        className="mt-5 flex flex-wrap items-center gap-3 px-6 sm:px-10"
        style={step(4)}
      >
        {PORTFOLIO_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChoose(id)}
            className={PILL}
          >
            {SPLASH_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Second full-bleed rule, separating the picker from the repeated
          Resumé / Contact links. */}
      <div className="mt-8 h-px w-full bg-black" style={step(5)} />

      <div
        className="mt-5 flex flex-wrap items-center gap-3 px-6 sm:px-10"
        style={step(6)}
      >
        <button type="button" onClick={() => onOpenInfo("resume")} className={PILL}>
          Resumé
        </button>
        <button type="button" onClick={() => onOpenInfo("contact")} className={PILL}>
          Contact
        </button>
      </div>

      {/* White triangle covering the top-right half, blended with `difference`
          so that diagonal corner renders inverted — white ground turns black,
          black type turns white. preserveAspectRatio="none" lets it stretch to
          any window shape, so the split always runs corner to corner. The
          splash root is `isolate`, which keeps the blend from reaching the
          gallery behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ mixBlendMode: "difference" }}
      >
        <svg
          className="h-full w-full"
          viewBox="0 0 612.9 612.9"
          preserveAspectRatio="none"
        >
          <polygon fill="#ffffff" points="0,0 612.9,612.9 612.9,0" />
        </svg>
      </div>
    </div>
  );
}
