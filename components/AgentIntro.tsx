"use client";

import { useEffect, useRef, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";
import AgentBlob from "./AgentBlob";

// Typed on in sequence, accumulating into one paragraph. Written as whole
// sentences rather than assembled from fragments so every degraded variant
// still reads like a person wrote it.
const BEAT_TWO =
  "“Interactive” has digital experiences, many in AI, AR, and 3D, activations, apps and rich media.";
const BEAT_THREE =
  "“Branding” for logo/identity, print, and packaging designs.";

const TAIL = "to the portfolios of Andy Weitzel, Creative Director.";

/** Visitor's own clock — the one variable that is never wrong. */
function timeOfDay(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

/**
 * Naming the visitor's city turned out to be a liability. IP lookup returns
 * where the ISP hands off, not where the person is — a Brooklyn visitor
 * resolved to Lynbrook, twenty miles out on Long Island — and one wrong place
 * name destroys the whole conceit far more effectively than a right one earns
 * it. Weather comes from the same coordinates but survives that error, because
 * it's true across a whole metro. So: keep what's reliably right, drop what
 * isn't. Set this true if the trade ever looks worth it again; the route still
 * returns the city.
 */
const NAME_THE_CITY = false;

/**
 * Steps down depending on what the lookup returned. Nothing here is allowed to
 * be load-bearing: weather can simply fail, and city is absent behind a VPN.
 */
function openingLine(city: string | null, weather: string | null): string {
  const tod = timeOfDay();
  if (NAME_THE_CITY && city && weather) {
    return `Welcome from a ${weather} ${tod} in ${city} ${TAIL}`;
  }
  if (NAME_THE_CITY && city) {
    return tod === "night"
      ? `Welcome from ${city} tonight ${TAIL}`
      : `Welcome from ${city} this ${tod} ${TAIL}`;
  }
  if (weather) return `Welcome from a ${weather} ${tod} ${TAIL}`;
  return tod === "night"
    ? `Welcome, and good evening, ${TAIL}`
    : `Welcome, this ${tod}, ${TAIL}`;
}

// Typing. Driven from elapsed time in a rAF loop rather than a per-character
// interval, which can't be trusted below ~16ms.
const CHARS_PER_SEC = 42;
const BEAT_PAUSE = 620; // ms of silence between sentences
const START_DELAY = 900; // lets the blob settle before it "speaks"

const NAME_SIZE = "clamp(20px, 2.2vw, 30px)";
const CAP_RATIO = 0.717;

const PILL =
  "inline-flex shrink-0 items-center rounded-full border border-black px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white min-[992px]:text-base";
const PILL_QUIET =
  "inline-flex shrink-0 items-center rounded-full border border-black/30 px-4 py-2 text-sm font-medium text-black/70 transition-colors hover:border-black hover:bg-black hover:text-white";

const SPLASH_LABELS: Record<PortfolioId, string> = {
  ...LABELS,
  interactive: "Interactive Experiences",
};

/**
 * Landing gate: a scripted agent — no model behind it — greets the visitor,
 * loosely places them, introduces the two portfolios, then hands over the
 * links. Same contract as the splash it replaced, so the parent is unaware of
 * the swap.
 */
export default function AgentIntro({
  onChoose,
  onOpenInfo,
  hiding,
  width,
  height,
}: {
  onChoose: (id: PortfolioId) => void;
  onOpenInfo: (kind: "resume" | "contact") => void;
  hiding: boolean;
  width: number;
  height: number;
}) {
  const [greeting, setGreeting] = useState<{
    city: string | null;
    weather: string | null;
  } | null>(null);
  const [typed, setTyped] = useState(0);
  const [done, setDone] = useState(false);
  const skipRef = useRef(false);

  // Hold the whole sequence until the lookup answers (or fails), so the first
  // sentence isn't rewritten under the cursor mid-type. Capped, because a
  // stalled request must not strand the landing.
  useEffect(() => {
    let alive = true;
    const settle = (g: { city: string | null; weather: string | null }) => {
      if (alive) setGreeting((prev) => prev ?? g);
    };
    const cap = setTimeout(() => settle({ city: null, weather: null }), 2500);
    fetch("/api/greeting")
      .then((r) => (r.ok ? r.json() : { city: null, weather: null }))
      .then(settle)
      .catch(() => settle({ city: null, weather: null }));
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, []);

  const beats = greeting
    ? [openingLine(greeting.city, greeting.weather), BEAT_TWO, BEAT_THREE]
    : null;
  const script = beats ? beats.join(" ") : "";

  // Boundaries in the joined string, so the cursor can rest between sentences.
  const stops = useRef<number[]>([]);
  if (beats) {
    let at = 0;
    stops.current = beats.map((b) => (at += b.length + 1) - 1);
  }

  useEffect(() => {
    if (!script) return;
    if (
      skipRef.current ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setTyped(script.length);
      setDone(true);
      return;
    }
    let raf = 0;
    let t0 = 0;
    let held = 0; // accumulated pause time, so pauses don't shorten the script
    let lastStop = -1;
    const tick = (now: number) => {
      // Skip has to stop the loop, not just jump the counter: the next frame
      // would otherwise write its own progress straight back over the top and
      // the caption would carry on typing from where it was.
      if (skipRef.current) {
        setTyped(script.length);
        setDone(true);
        return;
      }
      if (!t0) t0 = now;
      const ms = now - t0 - START_DELAY - held;
      let n = ms <= 0 ? 0 : Math.floor((ms / 1000) * CHARS_PER_SEC);
      // Rest at the end of each sentence before starting the next.
      for (const s of stops.current) {
        if (n >= s && s > lastStop) {
          const over = ((ms / 1000) * CHARS_PER_SEC - s) / CHARS_PER_SEC;
          if (over * 1000 < BEAT_PAUSE) {
            n = s;
          } else {
            lastStop = s;
            held += BEAT_PAUSE;
          }
          break;
        }
      }
      n = Math.min(n, script.length);
      setTyped(n);
      if (n < script.length) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script]);

  const skip = () => {
    skipRef.current = true;
    setTyped(script.length);
    setDone(true);
  };

  // Only "speaking" while characters are actually appearing — not during the
  // pauses between sentences, and not once it has finished.
  const speaking = !!script && typed > 0 && typed < script.length;

  const isPhone = width < 640;
  const capSize = isPhone
    ? "clamp(21px, 5.6vw, 30px)"
    : "clamp(26px, 2.9vw, 46px)";

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
      {/* Short viewports scroll rather than clip; auto margins on the middle
          row keep it centred without pushing the top out of reach once the
          content overflows (justify-center would). */}
      <div className="flex h-full w-full flex-col overflow-y-auto overscroll-contain">
        {/* Wordmark left, monogram right, across the top. */}
        <header className="flex shrink-0 items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
          <span
            className="font-medium leading-none tracking-tighter"
            style={{ fontSize: NAME_SIZE }}
          >
            Andy Weitzel
          </span>
          <LogoMark
            className="shrink-0 text-black"
            style={{ height: `calc(${NAME_SIZE} * ${CAP_RATIO} * 1.35)`, width: "auto" }}
          />
        </header>

        {/* Blob behind, captions on top. */}
        <main className="relative flex min-h-0 flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <AgentBlob
            speaking={speaking}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: `min(${Math.round(width * 0.92)}px, 1100px)`,
              height: `min(${Math.round(height * 0.62)}px, 620px)`,
            }}
          />
          <p
            className="relative mx-auto max-w-4xl text-center font-medium leading-snug"
            style={{ fontSize: capSize }}
          >
            {/* The finished sentence for assistive tech, so a half-typed
                paragraph never reaches a screen reader. */}
            <span className="sr-only">{script}</span>
            <span aria-hidden>
              {script.slice(0, typed)}
              <span
                className="-mr-[2px] ml-[1px] inline-block w-[2px] bg-current align-baseline"
                style={{
                  height: "0.95em",
                  verticalAlign: "-0.12em",
                  opacity: done ? 0 : undefined,
                  animation: done ? undefined : "caret-blink 0.9s step-end infinite",
                }}
              />
              {/* Transparent tail: holds the paragraph at its finished size and
                  final wrapping from the first frame, so the composition never
                  reflows as sentences accumulate. */}
              <span className="opacity-0">{script.slice(typed)}</span>
            </span>
          </p>
        </main>

        {/* Portfolios first, then the secondary pair, separated. */}
        <footer
          className="shrink-0 px-6 pb-8 sm:px-10 sm:pb-10"
          style={{
            opacity: done ? 1 : 0,
            transform: done ? "none" : "translateY(10px)",
            transition: "opacity 0.5s ease, transform 0.5s ease",
            pointerEvents: done ? "auto" : "none",
          }}
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            {PORTFOLIO_IDS.map((id) => (
              <button key={id} type="button" onClick={() => onChoose(id)} className={PILL}>
                {SPLASH_LABELS[id]}
              </button>
            ))}
          </div>
          <div className="mx-auto mt-5 flex max-w-xs items-center gap-4">
            <span className="h-px flex-1 bg-black/15" />
            <span className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => onOpenInfo("resume")} className={PILL_QUIET}>
                Resumé
              </button>
              <button type="button" onClick={() => onOpenInfo("contact")} className={PILL_QUIET}>
                Contact
              </button>
            </span>
            <span className="h-px flex-1 bg-black/15" />
          </div>
        </footer>
      </div>

      {/* Nobody should be held hostage by a typing animation on their second
          visit. Disappears the moment it has nothing left to skip. */}
      {!done && (
        <button
          type="button"
          onClick={skip}
          className="absolute bottom-5 right-5 z-10 rounded-full px-3 py-1.5 text-xs font-medium text-black/40 transition-colors hover:text-black"
        >
          Skip
        </button>
      )}
    </div>
  );
}
