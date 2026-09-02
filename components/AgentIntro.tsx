"use client";

import { useEffect, useRef, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";
import AgentBlob from "./AgentBlob";

/**
 * A sentence, as pieces rather than a string, so a phrase inside it can be
 * underlined and clickable — "Interactive Experiences" is both the name of the
 * portfolio and a way into it.
 */
interface Beat {
  parts: { text: string; link?: PortfolioId }[];
  /** Portfolio button lit while this sentence is being typed. */
  highlight?: PortfolioId;
  /** Once this beat lands, the portfolio buttons appear. */
  asks?: boolean;
}

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
 * The weather sentence, one per condition. Each is a whole line rather than a
 * template with a sign-off bolted on, so it can be phrased however it wants —
 * a stormy afternoon and a clear night don't want the same shape.
 *
 * Location and temperature are both optional (a VPN hides one, a partial
 * upstream reply the other), so every line is assembled rather than
 * interpolated blind — no "in undefined", no stray double spaces.
 */
/**
 * "a 76°F" but "an 80°F" — the article follows how the number is *said*, and
 * eight, eleven and eighteen all open on a vowel sound.
 */
function tempArticle(temp: string | null): string {
  if (!temp) return "a";
  const n = parseInt(temp, 10);
  if (Number.isNaN(n)) return "a";
  const an = n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89);
  return an ? "an" : "a";
}

function weatherLine(
  cond: string,
  temp: string | null,
  season: string,
  tod: string,
  place: string | null
): string {
  const at = place ? ` in ${place}` : "";
  const t = temp ? `${temp} ` : "";
  switch (cond) {
    case "stormy":
      return `Looks like a stormy ${t}${season} ${tod}.${
        place ? ` Stay dry in ${place}!` : " Stay dry!"
      }`;
    case "snowy":
      return `Looks like a snowy ${t}${season} ${tod}${at}. Stay in and get cozy!`;
    case "rainy":
    case "drizzly":
      return `Looks like a rainy ${t}${season} ${tod}${at}. Stay dry!`;
    case "foggy":
      return `Looks like a foggy ${t}${season} ${tod}${at}. Hoping for minimal travel.`;
    case "frigid":
      return `Looks like a frigid ${t}${season} ${tod}${at}. Stay warm and cozy!`;
    case "cold":
    case "cool":
      return `Looks like a chilly ${t}${season} ${tod}${at}. Time to get cozy!`;
    case "soon-to-be rainy":
      return `Could be rainy ${t}${season}${at} later. Stay dry!`;
    case "hot":
      return `It's ${tempArticle(temp)} ${t}hot ${season}${at}. Stay cool!`;
    case "humid":
      return `Looks like a humid ${t}${season} ${tod}${at}. Stay cool!`;
    case "sunny":
      return `Clear blue ${season} skies${at} this ${tod}.${
        temp ? ` Enjoy the ${temp} day!` : " Enjoy the day!"
      }`;
    case "clear":
      return `Clear ${season} skies tonight${at}. Perfect for star-gazing!`;
    case "partly cloudy":
      return `It's a partly cloudy ${season} ${tod}${at}. Pretty nice!`;
    case "overcast":
      return `It's an overcast ${season} ${tod}. Hope the sun breaks through for you!`;
    default: // mild, warm
      return `It's ${tempArticle(temp)} ${t}${season} ${tod}${at}. Nice!`;
  }
}

/**
 * The scripted beats. With no weather read there is nothing true to say about
 * where the visitor is, so the greeting drops the time of day too and simply
 * says hello rather than performing a familiarity it doesn't have.
 */
function buildBeats(
  place: string | null,
  weather: string | null,
  temp: string | null,
  season: string | null
): Beat[] {
  const tod = timeOfDay();
  const line = (text: string): Beat => ({ parts: [{ text }] });
  const beats: Beat[] = [];

  if (weather && season) {
    beats.push(line(tod === "night" ? "Good evening!" : `Good ${tod}!`));
    beats.push(line(weatherLine(weather, temp, season, tod, place)));
  } else {
    beats.push(line("Hello!"));
  }

  beats.push({ ...line("Which portfolio would you like to start with?"), asks: true });
  beats.push({
    highlight: "interactive",
    parts: [
      { text: "Interactive Experiences", link: "interactive" },
      { text: " include apps and digital experiences, activations, and rich media." },
    ],
  });
  beats.push({
    highlight: "branding",
    parts: [
      { text: "Branding", link: "branding" },
      { text: " includes logo/identity and print works." },
    ],
  });
  return beats;
}

// Typing. Driven from elapsed time in a rAF loop rather than a per-character
// interval, which can't be trusted below ~16ms.
const CHARS_PER_SEC = 40;
const BEAT_PAUSE = 1150; // ms of silence between sentences
const START_DELAY = 900; // lets the blob settle before it "speaks"
// How long after the last character the blob still counts as talking.
const TALK_GRACE_MS = 110;
// How far *before* a sentence ends the blob starts settling. The idle ramp
// takes about this long, so beginning it here means the blob arrives at rest
// as the last character lands, instead of carrying on afterwards.
const LEAD_OUT_MS = 380;

const NAME_SIZE = "clamp(22px, 2.5vw, 34px)";
const ROLE_SIZE = "clamp(12px, 1.05vw, 16px)";
// Floor on the shrink-to-fit below; past this the copy is too small to read
// and letting the page scroll is the better answer.
const MIN_CAP_FIT = 0.6;
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
  // The lockup and the blob arrive before the agent speaks. Held until the
  // webfonts settle, so the wordmark doesn't reflow from the fallback face
  // mid-fade; capped so a stalled font can't strand the page.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let alive = true;
    const show = () => alive && setRevealed(true);
    void Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 1500)),
    ]).then(show);
    return () => {
      alive = false;
    };
  }, []);
  const arrive = (delay: number): React.CSSProperties => ({
    opacity: revealed ? 1 : 0,
    transform: revealed ? "none" : "translateY(-10px)",
    transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
  });

  const [greeting, setGreeting] = useState<{
    place: string | null;
    weather: string | null;
    temp: string | null;
    season: string | null;
  } | null>(null);
  const [typed, setTyped] = useState(0);
  const [done, setDone] = useState(false);
  // Whether characters are appearing *right now*. Distinct from "not finished
  // yet": the counter sits still through every between-sentence rest, and the
  // blob has to settle in those gaps for the start/stop to read.
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);
  const skipRef = useRef(false);

  // Hold the whole sequence until the lookup answers (or fails), so the first
  // sentence isn't rewritten under the cursor mid-type. Capped, because a
  // stalled request must not strand the landing.
  useEffect(() => {
    let alive = true;
    const settle = (g: {
      place: string | null;
      weather: string | null;
      temp: string | null;
      season: string | null;
    }) => {
      if (alive) setGreeting((prev) => prev ?? g);
    };
    const cap = setTimeout(
      () => settle({ place: null, weather: null, temp: null, season: null }),
      2500
    );
    fetch("/api/greeting")
      .then((r) => (r.ok ? r.json() : { place: null, weather: null, temp: null, season: null }))
      .then(settle)
      .catch(() => settle({ place: null, weather: null, temp: null, season: null }));
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, []);

  const beats = greeting
    ? buildBeats(greeting.place, greeting.weather, greeting.temp, greeting.season)
    : null;

  // Flatten the beats to one run of segments carrying their absolute offset in
  // the script, so typing stays a single counter while the markup stays rich.
  const segments: {
    text: string;
    link?: PortfolioId;
    start: number;
    beat: number;
  }[] = [];
  let script = "";
  const stops = useRef<number[]>([]);
  const highlights = useRef<(PortfolioId | undefined)[]>([]);
  if (beats) {
    const ends: number[] = [];
    beats.forEach((b, bi) => {
      if (bi > 0) {
        // The join has to be a segment of its own, not just appended to the
        // script — anything not in a segment never gets rendered, and the
        // sentences ran together.
        segments.push({ text: " ", start: script.length, beat: bi });
        script += " ";
      }
      for (const part of b.parts) {
        segments.push({ ...part, start: script.length, beat: bi });
        script += part.text;
      }
      ends.push(script.length);
    });
    stops.current = ends;
    highlights.current = beats.map((b) => b.highlight);
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
    let lastN = 0;
    let lastAdvance = -Infinity; // not "advanced at navigation start"
    const tick = (now: number) => {
      // Skip has to stop the loop, not just jump the counter: the next frame
      // would otherwise write its own progress straight back over the top and
      // the caption would carry on typing from where it was.
      if (skipRef.current) {
        setTyped(script.length);
        setDone(true);
        talkingRef.current = false;
        setTalking(false);
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
            // `n` above was computed before this rest was discounted, so it
            // counts the entire pause as typing time — a whole sentence
            // appeared for one frame and then vanished again. Recompute.
            const after = now - t0 - START_DELAY - held;
            n = after <= 0 ? 0 : Math.floor((after / 1000) * CHARS_PER_SEC);
          }
          break;
        }
      }
      n = Math.min(n, script.length);
      // Grace window rather than a bare "did it advance this frame": at ~13ms
      // a character against a ~17ms frame, two frames occasionally land inside
      // one character and the state flickered off and straight back on.
      if (n > lastN) lastAdvance = now;
      lastN = n;
      // Start settling before the sentence lands. The lead is capped to a
      // share of the sentence's own length, or a short one ("Good morning!")
      // would be entirely inside the lead and never animate at all.
      const si = stops.current.findIndex((e) => e >= n);
      const end = si === -1 ? script.length : stops.current[si];
      const from = si <= 0 ? 0 : stops.current[si - 1] + 1;
      const sentenceMs = ((end - from) / CHARS_PER_SEC) * 1000;
      const lead = Math.min(LEAD_OUT_MS, sentenceMs * 0.35);
      const msLeft = ((end - n) / CHARS_PER_SEC) * 1000;
      const advancing =
        n < script.length &&
        now - lastAdvance < TALK_GRACE_MS &&
        msLeft > lead;
      if (advancing !== talkingRef.current) {
        talkingRef.current = advancing;
        setTalking(advancing);
      }
      setTyped(n);
      if (n < script.length) raf = requestAnimationFrame(tick);
      else {
        setDone(true);
        talkingRef.current = false;
        setTalking(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script]);

  const skip = () => {
    skipRef.current = true;
    setTyped(script.length);
    setDone(true);
  };

  const speaking = talking;

  // The segment the typing has reached — where the measuring marker goes.
  let caretSegment = 0;
  for (let i = 0; i < segments.length; i++) {
    if (typed >= segments[i].start) caretSegment = i;
  }

  /** Which sentence is being typed right now (-1 once finished). */
  const activeBeat = done
    ? -1
    : stops.current.findIndex((end) => typed <= end);
  const lit =
    activeBeat >= 0 ? highlights.current[activeBeat] ?? null : null;

  // Centre-until-it-wraps. `text-align` can't be animated between values, so
  // the paragraph is always left-aligned and nudged right by half its slack
  // while the copy still fits on one line; when it wraps, that offset goes to
  // zero and the transition below carries it home. The shift is applied
  // without a transition while still centred, so growing text stays centred
  // instead of chasing its own easing.
  const mainRef = useRef<HTMLElement>(null);
  const [mainH, setMainH] = useState(0);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setMainH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const capRef = useRef<HTMLParagraphElement>(null);
  const typedRef = useRef<HTMLSpanElement>(null);
  // Zero-width marker sitting immediately after the last typed character. The
  // run itself can't be measured directly — it also contains the transparent
  // tail, so its rects always span the finished paragraph.
  const caretRef = useRef<HTMLSpanElement>(null);
  const [centreShift, setCentreShift] = useState(0);
  const [multiLine, setMultiLine] = useState(false);
  useEffect(() => {
    const box = capRef.current;
    const run = typedRef.current;
    const mark = caretRef.current;
    if (!box || !run || !mark || !typed) return;
    const first = run.getClientRects()[0];
    if (!first) return;
    const at = mark.getBoundingClientRect();
    // Past the first line box means the copy has wrapped.
    const wrapped = at.top - first.top > first.height * 0.5;
    setMultiLine(wrapped);
    setCentreShift(
      wrapped ? 0 : Math.max(0, (box.clientWidth - (at.left - first.left)) / 2)
    );
  }, [typed, script, width]);

  // Not a fixed index any more: with no weather read there's no weather
  // sentence, so the question moves up one.
  const askBeat = beats ? beats.findIndex((b) => b.asks) : -1;

  // Each row of buttons arrives with the sentence that offers it.
  const past = (beat: number) =>
    done || (stops.current.length > beat && typed >= stops.current[beat]);
  const showPortfolios = askBeat >= 0 && past(askBeat);
  const showSecondary = done;

  const rowIn = (shown: boolean): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(10px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
    pointerEvents: shown ? "auto" : "none",
  });

  const isPhone = width < 640;
  // Width-driven ideal size. Height is handled separately, by measurement.
  const capBase = isPhone
    ? "clamp(21px, 5.6vw, 30px)"
    : "clamp(26px, 2.9vw, 46px)";

  // Shrink-to-fit against the region the copy actually has. A width-only size
  // is fine until the window is short, where the finished paragraph runs into
  // the wordmark above or the buttons below. The paragraph is always laid out
  // at its finished size (the transparent tail sees to that), so this measures
  // the same height from the first frame rather than growing as it types.
  const [capFit, setCapFit] = useState(1);
  // Start from the full size again whenever the box or the copy changes, so
  // the loop below only ever has to shrink.
  useEffect(() => setCapFit(1), [script, width, height]);
  useEffect(() => {
    const box = mainRef.current;
    const para = capRef.current;
    if (!box || !para) return;
    const pad = getComputedStyle(box);
    const avail =
      box.clientHeight -
      parseFloat(pad.paddingTop) -
      parseFloat(pad.paddingBottom);
    const used = para.scrollHeight;
    if (avail <= 0 || used <= 0 || used <= avail) return;
    // Scale the *current* size by how much it overshot, and repeat until it
    // fits. Solving it in one pass assumes height falls off linearly with font
    // size, which it doesn't — the copy re-wraps into fewer lines as it
    // shrinks, so a single ratio left it still overlapping on short windows.
    const next = Math.max(MIN_CAP_FIT, capFit * (avail / used) * 0.985);
    if (next < capFit - 0.004) setCapFit(next);
  }, [script, width, height, capFit]);

  const capSize = `calc(${capBase} * ${capFit.toFixed(3)})`;
  // Keep the blob inside the same region, so it can't bleed past the lockup.
  const blobSize = Math.round(Math.min(width * 0.98, mainH * 1.02, 1040));

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
        <header className="flex shrink-0 items-start justify-between px-6 pt-6 sm:px-10 sm:pt-8">
          <span className="flex flex-col items-start">
            <span
              className="font-medium leading-none tracking-tighter"
              style={{ fontSize: NAME_SIZE, ...arrive(0) }}
            >
              Andy Weitzel
            </span>
            <span
              className="mt-2 leading-none text-black"
              style={{ fontSize: ROLE_SIZE, ...arrive(90) }}
            >
              Creative Director
            </span>
          </span>
          <LogoMark
            className="shrink-0 text-black"
            style={{
              height: `calc(${NAME_SIZE} * ${CAP_RATIO} * 1.35)`,
              width: "auto",
              ...arrive(140),
            }}
          />
        </header>

        {/* Blob behind, captions on top. */}
        <main
          ref={mainRef}
          className="relative flex min-h-0 flex-1 items-center justify-center px-6 py-10 sm:px-10"
        >
          <AgentBlob
            speaking={speaking}
            // Centring lives in the transform, not utility classes, so the
            // arrival scale can compose with it.
            className="pointer-events-none absolute left-1/2 top-1/2"
            // Square, so the shader's circle isn't cropped into an ellipse by
            // its own box. Copy overhangs the sides slightly, which reads as
            // deliberate; the alternative is a blob wider than the screen.
            style={{
              width: blobSize,
              height: blobSize,
              opacity: revealed ? 1 : 0,
              transform: `translate(-50%, -50%) scale(${revealed ? 1 : 0.82})`,
              transition:
                "opacity 0.9s ease 260ms, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1) 260ms",
            }}
          />
          {/* Centred while the copy is still one line, then slid to its
              left-aligned home once it wraps. Done as a translate rather than
              text-align, which can't be animated — see `centreShift`. */}
          <p
            ref={capRef}
            className="relative mx-auto max-w-3xl text-left font-medium leading-snug"
            style={{
              fontSize: capSize,
              transform: `translateX(${centreShift}px)`,
              transition: multiLine ? "transform 0.55s ease" : "none",
            }}
          >
            {/* The finished sentence for assistive tech, so a half-typed
                paragraph never reaches a screen reader. */}
            <span className="sr-only">{script}</span>
            <span aria-hidden ref={typedRef}>
              {segments.map((seg, i) => {
                const shown = Math.max(0, Math.min(typed - seg.start, seg.text.length));
                const vis = seg.text.slice(0, shown);
                const rest = seg.text.slice(shown);
                const isCaret = i === caretSegment;
                return (
                  <span key={i}>
                    {seg.link ? (
                      <span
                        role="button"
                        tabIndex={vis ? 0 : -1}
                        onClick={() => vis && onChoose(seg.link!)}
                        onKeyDown={(e) => {
                          if (vis && (e.key === "Enter" || e.key === " ")) onChoose(seg.link!);
                        }}
                        className="cursor-pointer underline decoration-2 underline-offset-4 transition-opacity hover:opacity-60"
                      >
                        {vis}
                      </span>
                    ) : (
                      vis
                    )}
                    {isCaret && (
                      // Full line-height, not a zero-height box: an empty
                      // inline sits *on* the baseline, so its top lands most
                      // of a line below the line box and every measurement
                      // read as "already wrapped".
                      <span
                        ref={caretRef}
                        className="inline-block w-0 align-baseline"
                        style={{ height: "1em" }}
                      />
                    )}
                    {/* Transparent tail: holds the paragraph at its finished
                        size and final wrapping from the first frame, so the
                        composition never reflows as sentences accumulate. */}
                    <span className="opacity-0">{rest}</span>
                  </span>
                );
              })}
            </span>
          </p>
        </main>

        {/* Portfolios first, then the secondary pair, separated. */}
        <footer className="shrink-0 px-6 pb-8 sm:px-10 sm:pb-10">
          <div
            className="flex flex-wrap items-center justify-center gap-3"
            style={rowIn(showPortfolios)}
          >
            {PORTFOLIO_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onChoose(id)}
                className={`${PILL} ${lit === id ? "bg-black text-white" : ""}`}
              >
                {SPLASH_LABELS[id]}
              </button>
            ))}
          </div>
          <div
            className="mx-auto mt-5 flex max-w-xs items-center gap-4"
            style={rowIn(showSecondary)}
          >
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
