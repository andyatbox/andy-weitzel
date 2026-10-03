"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "@/lib/portfolios";
import LogoMark from "./LogoMark";
import NameWheel from "./NameWheel";
import IntroCube from "./IntroCube";
import WeatherPanel from "./WeatherPanel";
import type { Greeting } from "@/app/api/greeting/route";

/**
 * A sentence, as pieces rather than a string, so a phrase inside it can be
 * underlined and clickable — "Interactive Experiences" is both the name of the
 * portfolio and a way into it.
 */
interface Beat {
  parts: { text: string; link?: PortfolioId }[];
  /** Rest after this beat before the next starts. Everything else runs on. */
  pause?: boolean;
}

/**
 * The script. The weather and place used to be a sentence here; they're drawn
 * as a row of data graphics above it now (WeatherPanel), so the copy itself
 * is the same for everyone.
 */
function buildBeats(): Beat[] {
  const line = (text: string): Beat => ({ parts: [{ text }] });
  return [
    // The script's one rest: let the greeting land before the question.
    { ...line("Hello."), pause: true },
    // The question closes the script; the portfolio buttons below answer it.
    line("Which portfolio would you like to start with?"),
  ];
}

// Typing. Driven from elapsed time in a rAF loop rather than a per-character
// interval, which can't be trusted below ~16ms.
const CHARS_PER_SEC = 60;
const BEAT_PAUSE = 1150; // ms of silence after the greeting (see Beat.pause)
// When there's weather to show, the panel starts arriving first and the
// typing follows partway through its entrance.
const PANEL_LEAD_MS = 700;
// How long after the last character the agent still counts as talking.
const TALK_GRACE_MS = 110;
// How far *before* a sentence ends the agent starts settling. The idle ramp
// takes about this long, so beginning it here means the scene arrives at rest
// as the last character lands, instead of carrying on afterwards.
const LEAD_OUT_MS = 380;

const NAME_SIZE = "clamp(22px, 2.5vw, 34px)";
// Floor on the shrink-to-fit below; past this the copy is too small to read
// and letting the page scroll is the better answer.
const MIN_CAP_FIT = 0.6;
const CAP_RATIO = 0.717;

const PILL =
  "inline-flex shrink-0 items-center rounded-full border-2 border-white px-5 py-2.5 text-lg font-medium text-white transition-colors hover:bg-white hover:text-black min-[992px]:px-8 min-[992px]:py-3 min-[992px]:text-[22px]";
const PILL_QUIET =
  "inline-flex shrink-0 items-center rounded-full border border-white/30 px-5 py-2 text-base font-medium text-white/70 transition-colors hover:border-white hover:bg-white hover:text-black";

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
  // The lockup arrives before the agent speaks. Held until the
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

  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [typed, setTyped] = useState(0);
  // Whether characters are appearing *right now*. Distinct from "not finished
  // yet": the counter sits still through the rest after the greeting, and the
  // scene has to settle in that gap for the start/stop to read.
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);

  // Hold the whole sequence until the lookup answers (or fails), so the
  // panel and the copy arrive together rather than the panel landing late
  // above copy that's already typing. Capped, because a stalled request must
  // not strand the landing.
  useEffect(() => {
    let alive = true;
    const none: Greeting = { place: null, weather: null };
    const settle = (g: Greeting) => {
      if (alive) setGreeting((prev) => prev ?? g);
    };
    const cap = setTimeout(() => settle(none), 2500);
    fetch("/api/greeting")
      .then((r) => (r.ok ? (r.json() as Promise<Greeting>) : none))
      .then(settle)
      .catch(() => settle(none));
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, []);

  const beats = greeting ? buildBeats() : null;
  // Anything to draw above the copy. Without it the copy is alone and keeps
  // its centre-until-it-wraps behaviour; with it, it sits left under the
  // panel from the first character.
  const hasPanel = !!(greeting && (greeting.place || greeting.weather));

  // Flatten the beats to one run of segments carrying their absolute offset in
  // the script, so typing stays a single counter while the markup stays rich.
  const segments: {
    text: string;
    link?: PortfolioId;
    start: number;
    beat: number;
    /** Join that follows a resting beat: drawn as a spaced line break. */
    brk?: boolean;
  }[] = [];
  let script = "";
  const stops = useRef<number[]>([]);
  // The subset of `stops` that rest before typing on.
  const pauses = useRef<number[]>([]);
  if (beats) {
    const ends: number[] = [];
    const rests: number[] = [];
    beats.forEach((b, bi) => {
      if (bi > 0) {
        // The join has to be a segment of its own, not just appended to the
        // script — anything not in a segment never gets rendered, and the
        // sentences ran together.
        segments.push({
          text: " ",
          start: script.length,
          beat: bi,
          brk: !!beats[bi - 1].pause,
        });
        script += " ";
      }
      for (const part of b.parts) {
        segments.push({ ...part, start: script.length, beat: bi });
        script += part.text;
      }
      ends.push(script.length);
      if (b.pause) rests.push(script.length);
    });
    stops.current = ends;
    pauses.current = rests;
  }

  useEffect(() => {
    if (!script) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTyped(script.length);
      return;
    }
    let raf = 0;
    let t0 = 0;
    let held = 0; // accumulated pause time, so pauses don't shorten the script
    let lastStop = -1;
    let lastN = 0;
    let lastAdvance = -Infinity; // not "advanced at navigation start"
    const startAfter = hasPanel ? PANEL_LEAD_MS : 0;
    const tick = (now: number) => {
      if (!t0) t0 = now + startAfter;
      const ms = now - t0 - held;
      let n = ms <= 0 ? 0 : Math.floor((ms / 1000) * CHARS_PER_SEC);
      // Rest at the end of the greeting before starting the next sentence.
      for (const s of pauses.current) {
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
            const after = now - t0 - held;
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
      // Start settling before the typing stops. Only a rest or the finish
      // counts: sentences otherwise run straight on, and settling at every
      // full stop would settle the scene while characters were still appearing.
      // The lead is capped to a share of the run's own length, or a short one
      // ("Hello.") would be entirely inside the lead and never animate at all.
      const si = pauses.current.findIndex((e) => e >= n);
      const end = si === -1 ? script.length : pauses.current[si];
      const from = si <= 0 ? 0 : pauses.current[si - 1] + 1;
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
        talkingRef.current = false;
        setTalking(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script, hasPanel]);

  const speaking = talking;

  // The segment the typing has reached — where the measuring marker goes.
  let caretSegment = 0;
  for (let i = 0; i < segments.length; i++) {
    if (typed >= segments[i].start) caretSegment = i;
  }

  // Centre-until-it-wraps. `text-align` can't be animated between values, so
  // the paragraph is always left-aligned and nudged right by half its slack
  // while the copy still fits on one line; when it wraps, that offset goes to
  // zero and the transition below carries it home. The shift is applied
  // without a transition while still centred, so growing text stays centred
  // instead of chasing its own easing.
  const mainRef = useRef<HTMLElement>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
  // The weather panel and the copy together — what has to fit.
  const colRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef<HTMLSpanElement>(null);
  // Zero-width marker sitting immediately after the last typed character. The
  // run itself can't be measured directly — it also contains the transparent
  // tail, so its rects always span the finished paragraph.
  const caretRef = useRef<HTMLSpanElement>(null);
  const [centreShift, setCentreShift] = useState(0);
  const [multiLine, setMultiLine] = useState(false);
  // A layout effect, not a passive one: it measures the DOM and feeds the
  // result straight back into layout, on every character typed. As a passive
  // effect that was a setState-after-render chain once per frame for the
  // whole script, which React eventually flags as a runaway loop ("Maximum
  // update depth exceeded"); it could also paint a frame with the previous
  // centring before correcting it. Layout effects resolve before paint.
  useLayoutEffect(() => {
    const box = capRef.current;
    const run = typedRef.current;
    const mark = caretRef.current;
    if (!box || !run || !mark || !typed) return;
    if (hasPanel) {
      setMultiLine(false);
      setCentreShift(0);
      return;
    }
    const first = run.getClientRects()[0];
    if (!first) return;
    const at = mark.getBoundingClientRect();
    // Past the first line box means the copy has wrapped.
    const wrapped = at.top - first.top > first.height * 0.5;
    setMultiLine(wrapped);
    setCentreShift(
      wrapped ? 0 : Math.max(0, (box.clientWidth - (at.left - first.left)) / 2)
    );
  }, [typed, script, width, hasPanel]);

  // Both rows ease in with the first character rather than waiting for the
  // sentence that offers them. The script is no longer skippable, so holding
  // the links back would keep the way out of the landing hidden for its whole
  // run — and a visitor who already knows where they're going shouldn't have
  // to sit through an introduction to leave.
  const showLinks = typed > 0;

  const rowIn = (shown: boolean): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(10px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
    pointerEvents: shown ? "auto" : "none",
  });

  const isPhone = width < 640;
  // Width-driven ideal size. Height is handled separately, by measurement.
  // Sized up once the script lost its two portfolio sentences: there's room
  // now, and the shrink-to-fit below still guards short windows.
  const capBase = isPhone
    ? "clamp(25px, 6.8vw, 36px)"
    : "clamp(32px, 3.8vw, 62px)";

  // Shrink-to-fit against the region the copy actually has. A width-only size
  // is fine until the window is short, where the panel and paragraph run into
  // the wordmark above or the buttons below. The paragraph is always laid out
  // at its finished size (the transparent tail sees to that), so this measures
  // the same height from the first frame rather than growing as it types. The
  // panel scales by the same factor, so the two shrink as one.
  const [capFit, setCapFit] = useState(1);
  // Start from the full size again whenever the box or the copy changes, so
  // the loop below only ever has to shrink.
  useEffect(() => setCapFit(1), [script, width, height]);
  useEffect(() => {
    const box = mainRef.current;
    const col = colRef.current;
    if (!box || !col) return;
    const pad = getComputedStyle(box);
    const avail =
      box.clientHeight -
      parseFloat(pad.paddingTop) -
      parseFloat(pad.paddingBottom);
    const used = col.scrollHeight;
    if (avail <= 0 || used <= 0 || used <= avail) return;
    // Scale the *current* size by how much it overshot, and repeat until it
    // fits. Solving it in one pass assumes height falls off linearly with font
    // size, which it doesn't — the copy re-wraps into fewer lines as it
    // shrinks, so a single ratio left it still overlapping on short windows.
    const next = Math.max(MIN_CAP_FIT, capFit * (avail / used) * 0.985);
    if (next < capFit - 0.004) setCapFit(next);
  }, [script, width, height, capFit, hasPanel]);

  const capSize = `calc(${capBase} * ${capFit.toFixed(3)})`;
  const panelSize = `calc(${isPhone ? "clamp(20px, 5.6vw, 24px)" : "clamp(22px, 2.3vw, 36px)"} * ${capFit.toFixed(3)})`;

  return (
    <div
      data-splash
      className="fixed inset-x-0 top-0 isolate z-[80] w-full overflow-hidden bg-black text-white"
      style={{
        height,
        opacity: hiding ? 0 : 1,
        pointerEvents: hiding ? "none" : "auto",
        transition: "opacity 0.4s ease",
      }}
    >
      {/* The reel cube owns the whole viewport behind the copy — it isn't
          boxed into the caption row the way the blob it replaced was. */}
      <IntroCube speaking={speaking} visible={!hiding} />

      {/* A quiet bed for the copy. The reel is bright and busy — white type
          straight over it loses whole phrases whenever a pale frame comes up.
          A scrim between the two keeps the cube's own colour intact rather
          than dimming the scene itself. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5] bg-black/45"
      />

      {/* Short viewports scroll rather than clip; auto margins on the middle
          row keep it centred without pushing the top out of reach once the
          content overflows (justify-center would). */}
      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto overscroll-contain">
        {/* Wordmark left, monogram right, across the top. */}
        <header className="flex shrink-0 items-start justify-between px-6 pt-6 sm:px-10 sm:pt-8">
          {/* Nudged down to sit on the logo's baseline. The wheel's box is
              taller than its type (it has to clear descenders as it rolls), so
              aligning the two boxes at the top leaves the wordmark reading
              high. Stated in em so it tracks the fluid type size rather than
              overshooting once the wordmark shrinks on a phone. */}
          <NameWheel
            className="font-medium tracking-tighter"
            style={{ fontSize: NAME_SIZE, marginTop: "0.15em", ...arrive(0) }}
          />
          <LogoMark
            className="shrink-0 text-white"
            style={{
              height: `calc(${NAME_SIZE} * ${CAP_RATIO} * 1.6)`,
              width: "auto",
              ...arrive(140),
            }}
          />
        </header>

        {/* Captions ride over the cube. */}
        <main
          ref={mainRef}
          className="relative flex min-h-0 flex-1 items-center justify-center px-6 py-10 sm:px-10"
        >
          <div ref={colRef} className="mx-auto w-full max-w-3xl">
            {greeting && hasPanel && (
              <div className="mb-8 md:mb-12">
                <WeatherPanel
                  place={greeting.place}
                  weather={greeting.weather}
                  shown={revealed}
                  size={panelSize}
                />
              </div>
            )}
            {/* Alone, centred while the copy is still one line, then slid to
                its left-aligned home once it wraps. Done as a translate rather
                than text-align, which can't be animated — see `centreShift`. */}
            <p
              ref={capRef}
              className="relative text-left font-medium leading-[1.12]"
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
                      ) : seg.brk ? (
                        // The greeting stands apart from the pitch that follows.
                        // Drawn from the first frame, like the transparent tail,
                        // so the gap never pops in and reflows the paragraph.
                        <span className="block" style={{ height: "0.5em" }} />
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
                      {!seg.brk && <span className="opacity-0">{rest}</span>}
                    </span>
                  );
                })}
              </span>
            </p>
          </div>
        </main>

        {/* Portfolios first, then the secondary pair, separated. */}
        <footer className="shrink-0 px-6 pb-8 sm:px-10 sm:pb-10">
          <div
            className="flex flex-wrap items-center justify-center gap-3"
            style={rowIn(showLinks)}
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
          <div
            className="mx-auto mt-5 flex max-w-sm items-center gap-4"
            style={rowIn(showLinks)}
          >
            <span className="h-px flex-1 bg-white/20" />
            <span className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => onOpenInfo("resume")} className={PILL_QUIET}>
                Resumé
              </button>
              <button type="button" onClick={() => onOpenInfo("contact")} className={PILL_QUIET}>
                Contact
              </button>
            </span>
            <span className="h-px flex-1 bg-white/20" />
          </div>
        </footer>
      </div>

    </div>
  );
}
