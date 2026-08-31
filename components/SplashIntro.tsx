"use client";

import { useEffect, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";

// Left column copy, typed on. Wraps normally — the transparent tail in the
// markup below reserves its final size so nothing reflows as it types.
const BIO =
  "Creative Director, full-stack developer, and visual artist with over two decades of experience at the intersection of design, brand strategy, and emerging technology. Co-founded Box Creative in 2007 and serves as its hands-on Creative Director and CCO, shipping award-winning campaigns, digital experiences, and branding solutions for Fortune 50 businesses and startups alike. Work spans identity systems, integrated marketing, immersive AR/AI/3D experiences, and application development — a rare fluency across the full creative-to-technical pipeline.";

// Staggered reveal: each element slides up and fades in, one after the next.
const REVEAL_STEP = 80; // ms between elements
const REVEAL_DUR = 380; // ms per element
const REVEAL_STEPS = 6; // lockup, rule, bio, question, pills, links
// Don't wait on webfonts forever if they fail or stall — reveal regardless.
const FONT_WAIT_CAP = 2000;

// Typing rate. Driven off elapsed time in a rAF loop rather than a per-char
// setInterval, which can't be trusted below ~16ms and stutters when it slips.
const TYPE_CHARS_PER_SEC = 190;
// Hold until the bio column has finished its own fade-in (step 2), so the
// caret starts on a settled element instead of one still sliding up.
const TYPE_START_DELAY = 2 * REVEAL_STEP + REVEAL_DUR;

const NAME_SIZE = "clamp(34px, 6vw, 86px)";
// New Spirit Medium's cap height as a fraction of font size, measured from the
// rendered face (canvas actualBoundingBoxAscent of "A" ÷ font size). The logo
// is an all-caps monogram, so sizing it to cap height — and baseline-aligning
// it — makes it read as the same size as the wordmark's capitals.
const CAP_RATIO = 0.717;
const LOGO_SIZE = `calc(${NAME_SIZE} * ${CAP_RATIO})`;
// Body copy size, used for the bio and everything under the divider.
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
  const [typed, setTyped] = useState(0);

  // Hold everything hidden until the webfonts have settled, then run the
  // stagger. Revealing earlier means watching the copy reflow from the
  // fallback face into New Spirit, which is the ugly part.
  useEffect(() => {
    let alive = true;
    const start = () => {
      if (alive) setRevealed(true);
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void Promise.race([
      fonts,
      new Promise((res) => setTimeout(res, FONT_WAIT_CAP)),
    ]).then(start);
    return () => {
      alive = false;
    };
  }, []);

  // Type the bio on once its column is up. Reduced-motion visitors get the
  // finished paragraph rather than a 4s animation they didn't ask for.
  useEffect(() => {
    if (!revealed) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTyped(BIO.length);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const ms = now - t0 - TYPE_START_DELAY;
      const n = ms <= 0 ? 0 : Math.floor((ms / 1000) * TYPE_CHARS_PER_SEC);
      // React bails out when this lands on the same count, so the frames
      // between characters cost nothing.
      setTyped(Math.min(n, BIO.length));
      if (n < BIO.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealed]);

  // Slide-fade for the nth element in the sequence.
  const step = (i: number): React.CSSProperties => ({
    opacity: revealed ? 1 : 0,
    transform: revealed ? "none" : "translateY(14px)",
    transition: `opacity ${REVEAL_DUR}ms ease ${i * REVEAL_STEP}ms, transform ${REVEAL_DUR}ms ease ${i * REVEAL_STEP}ms`,
  });

  return (
    <div
      data-splash
      className="fixed inset-x-0 top-0 isolate z-[80] w-full overflow-hidden bg-white text-black"
      style={{
        height,
        opacity: hiding ? 0 : 1,
        pointerEvents: hiding ? "none" : "auto",
        transition: "opacity 0.4s ease",
      }}
    >
      {/* The stacked (single-column) layout is taller than a short phone, so
          this scrolls rather than clipping. `m-auto` on the block below — not
          justify-center on this container — does the vertical centering: auto
          margins collapse to 0 once the content overflows, where centering
          would instead push the top of it out of reach above the scrollport. */}
      <div className="flex h-full w-full flex-col overflow-y-auto overscroll-contain">
        <div className="m-auto w-full py-8">
          {/* Wordmark left, logo pushed to the page's right gutter and sitting
              on the wordmark's baseline. Stacks (logo on top, left-aligned)
              below the sm breakpoint. Baseline alignment works because an SVG
              is a replaced element, so its baseline is its bottom edge. */}
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

          {/* Full-bleed rule dividing the name lockup from the two columns. */}
          <div className="mt-5 h-px w-full bg-black" style={step(1)} />

          {/* Bio left, picker right; stacked below md. */}
          <div className="mt-6 grid gap-8 px-6 sm:px-10 md:mt-8 md:grid-cols-2 md:gap-14">
            <p
              className="leading-relaxed"
              style={{ fontSize: COPY_SIZE, ...step(2) }}
            >
              {/* The full sentence for assistive tech, so the type-on never
                  leaks a half-written paragraph into a screen reader. */}
              <span className="sr-only">{BIO}</span>
              <span aria-hidden>
                {BIO.slice(0, typed)}
                {/* Zero-width in layout (the negative margin cancels its own
                    width) so the caret can't nudge a word onto the next line
                    mid-type. */}
                <span
                  className="-mr-[2px] inline-block w-[2px] bg-current"
                  style={{
                    height: "1em",
                    verticalAlign: "-0.13em",
                    opacity: typed >= BIO.length ? 0 : undefined,
                    animation:
                      typed >= BIO.length
                        ? undefined
                        : "caret-blink 0.9s step-end infinite",
                  }}
                />
                {/* Transparent tail: holds the paragraph at its finished size
                    and final wrapping from the first frame, so neither this
                    column nor the one beside it reflows while typing. */}
                <span className="opacity-0">{BIO.slice(typed)}</span>
              </span>
            </p>

            <div>
              <p
                className="font-medium"
                style={{ fontSize: COPY_SIZE, ...step(3) }}
              >
                Which portfolio would you like to start with?
              </p>

              <div
                className="mt-5 flex flex-wrap items-center gap-3"
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

              {/* Column-width rule separating the picker from the repeated
                  Resumé / Contact links. */}
              <div
                className="mt-8 flex flex-wrap items-center gap-3 border-t border-black pt-8"
                style={step(5)}
              >
                <button
                  type="button"
                  onClick={() => onOpenInfo("resume")}
                  className={PILL}
                >
                  Resumé
                </button>
                <button
                  type="button"
                  onClick={() => onOpenInfo("contact")}
                  className={PILL}
                >
                  Contact
                </button>
              </div>
            </div>
          </div>
        </div>
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
