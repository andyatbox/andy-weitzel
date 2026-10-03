"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Weather, WeatherIcon } from "@/app/api/greeting/route";

/**
 * Landing dateline: where the visitor roughly is and their weather, as a row of
 * small data graphics rather than a sentence — conditions now, today's range
 * with "now" marked on it, the chance of rain as a gauge, the wind as a dial,
 * and the next three days.
 *
 * Everything arrives on `shown`: the cells rise in one after another, line
 * icons draw themselves on, the gauges sweep to their values and the numbers
 * count up. The motion lives in globals.css (`.wx-*`) and stands down under
 * reduced motion.
 */

// Delay between consecutive cells arriving, and how long a cell takes.
const STEP_MS = 90;
const RISE_MS = 600;
const COUNT_MS = 900;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up to its value once shown, holding its final width. */
function Count({ to, shown, delay }: { to: number; shown: boolean; delay: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!shown) return;
    if (reducedMotion()) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
      setV(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, shown, delay]);
  // The final value, invisible, sets the width; the counting one sits over it,
  // so the row doesn't reflow as digits are added.
  return (
    <span className="relative inline-block">
      <span className="invisible">{to}</span>
      <span className="absolute inset-0">{v}</span>
    </span>
  );
}

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// The open-bottomed cloud the precipitation icons hang their drops from.
const CLOUD_OPEN = "M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24";

/**
 * Line pictogram for a condition. Every stroke carries pathLength=1 so the
 * draw-on in globals.css can treat them all alike; the groups carry the small
 * ambient loops (rays turning, drops falling, a flicker in the bolt).
 */
function Icon({ kind, className, delay = 0 }: { kind: WeatherIcon; className?: string; delay?: number }) {
  const P = (d: string) => <path d={d} pathLength={1} />;
  let body: ReactNode;
  switch (kind) {
    case "clear-day":
      body = (
        <>
          <circle cx="12" cy="12" r="4" pathLength={1} />
          <g className="wx-spin">
            {P("M12 2v2")}
            {P("M12 20v2")}
            {P("m4.93 4.93 1.41 1.41")}
            {P("m17.66 17.66 1.41 1.41")}
            {P("M2 12h2")}
            {P("M20 12h2")}
            {P("m6.34 17.66-1.41 1.41")}
            {P("m19.07 4.93-1.41 1.41")}
          </g>
        </>
      );
      break;
    case "clear-night":
      body = (
        <>
          {P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z")}
          <g className="wx-twinkle">{P("M19 3v3M17.5 4.5h3")}</g>
        </>
      );
      break;
    case "partly-day":
      body = (
        <>
          <g className="wx-twinkle">
            {P("M12 2v2")}
            {P("m4.93 4.93 1.41 1.41")}
            {P("M20 12h2")}
            {P("m19.07 4.93-1.41 1.41")}
          </g>
          {P("M15.95 12.65a4 4 0 0 0-5.93-4.13")}
          <g className="wx-drift">{P("M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z")}</g>
        </>
      );
      break;
    case "partly-night":
      body = (
        <>
          {P("M10.1 9A6 6 0 0 1 16 4a4 4 0 0 0 6 6 6 6 0 0 1-3 5.2")}
          <g className="wx-drift">{P("M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6z")}</g>
        </>
      );
      break;
    case "cloudy":
      body = <g className="wx-drift">{P("M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z")}</g>;
      break;
    case "fog":
      body = (
        <>
          {P(CLOUD_OPEN)}
          <g className="wx-drift">{P("M16 17H7")}</g>
          <g className="wx-drift wx-drift--back">{P("M17 21H9")}</g>
        </>
      );
      break;
    case "drizzle":
      body = (
        <>
          {P(CLOUD_OPEN)}
          <g className="wx-fall">
            {P("M8 15v1")}
            {P("M12 17v1")}
            {P("M16 15v1")}
            {P("M8 19v1")}
            {P("M12 21v1")}
            {P("M16 19v1")}
          </g>
        </>
      );
      break;
    case "rain":
      body = (
        <>
          {P(CLOUD_OPEN)}
          <g className="wx-fall">
            {P("M8 14v5")}
            {P("M12 16v5")}
            {P("M16 14v5")}
          </g>
        </>
      );
      break;
    case "snow":
      body = (
        <>
          {P(CLOUD_OPEN)}
          <g className="wx-fall wx-fall--slow" strokeWidth={2.2}>
            {P("M8 15h.01")}
            {P("M12 17h.01")}
            {P("M16 15h.01")}
            {P("M8 19h.01")}
            {P("M12 21h.01")}
            {P("M16 19h.01")}
          </g>
        </>
      );
      break;
    case "storm":
      body = (
        <>
          {P("M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97")}
          <g className="wx-flash">{P("m13 12-3 5h4l-3 5")}</g>
        </>
      );
      break;
  }
  return (
    <svg
      {...svgProps}
      className={`wx-draw ${className ?? ""}`}
      style={{ "--wx-delay": `${delay}ms` } as React.CSSProperties}
    >
      {body}
    </svg>
  );
}

/** Today's low-to-high as a line, with a dot for where "now" sits on it. */
function RangeBar({ low, high, now, shown, delay }: { low: number; high: number; now: number; shown: boolean; delay: number }) {
  const span = Math.max(1, high - low);
  const at = Math.min(1, Math.max(0, (now - low) / span)) * 100;
  const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
  return (
    <span className="relative block h-full w-full min-w-[64px]">
      <span
        className="absolute inset-x-0 top-1/2 h-px origin-left bg-white/45"
        style={{
          transform: `translateY(-50%) scaleX(${shown ? 1 : 0})`,
          transition: `transform 0.9s ${ease} ${delay}ms`,
        }}
      />
      {[0, 100].map((x) => (
        <span
          key={x}
          className="absolute top-1/2 h-[9px] w-px -translate-x-1/2 -translate-y-1/2 bg-white/70"
          style={{ left: `${x}%`, opacity: shown ? 1 : 0, transition: `opacity 0.4s ease ${delay + (x ? 700 : 0)}ms` }}
        />
      ))}
      <span
        className="absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
        style={{
          left: `${shown ? at : 0}%`,
          opacity: shown ? 1 : 0,
          transition: `left 1.1s ${ease} ${delay + 250}ms, opacity 0.3s ease ${delay + 250}ms`,
        }}
      />
    </span>
  );
}

/** Chance of rain as a ring that fills clockwise from twelve o'clock. */
function RainGauge({ pct, shown, delay }: { pct: number; shown: boolean; delay: number }) {
  const p = Math.min(1, Math.max(0, pct / 100));
  return (
    <svg {...svgProps} className="h-full w-auto">
      <circle cx="12" cy="12" r="10" className="opacity-30" />
      {p > 0 && (
        <circle
          cx="12"
          cy="12"
          r="10"
          pathLength={1}
          transform="rotate(-90 12 12)"
          style={{
            strokeDasharray: `${shown ? p : 0} 2`,
            transition: `stroke-dasharray 1.1s cubic-bezier(0.65, 0, 0.35, 1) ${delay}ms`,
          }}
        />
      )}
      {/* The drop the ring is measuring. */}
      <path d="M12 7.5c-1.7 2.1-2.6 3.5-2.6 4.8a2.6 2.6 0 0 0 5.2 0c0-1.3-.9-2.7-2.6-4.8z" strokeWidth={1.2} />
    </svg>
  );
}

/**
 * Wind as a dial: the arrow points where the wind is heading (the reading is
 * where it comes from, so +180°), swings round to it on arrival, then sways a
 * little as if gusting.
 */
function WindDial({ deg, shown, delay }: { deg: number; shown: boolean; delay: number }) {
  return (
    <svg {...svgProps} className="h-full w-auto">
      <circle cx="12" cy="12" r="10" className="opacity-30" />
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d="M12 2v1.6" transform={`rotate(${a} 12 12)`} className="opacity-60" />
      ))}
      <g
        style={{
          transform: `rotate(${shown ? deg + 180 : 0}deg)`,
          transformOrigin: "12px 12px",
          transition: `transform 1.4s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms`,
        }}
      >
        <g className="wx-gust">
          <path d="M12 17V7" />
          <path d="M8.8 10.2 12 7l3.2 3.2" />
        </g>
      </g>
    </svg>
  );
}

function Cell({
  i,
  shown,
  className,
  graphic,
  value,
  label,
}: {
  i: number;
  shown: boolean;
  className: string;
  graphic: ReactNode;
  value: ReactNode;
  label: ReactNode;
}) {
  const d = i * STEP_MS;
  return (
    <div
      className={`flex min-w-0 flex-col gap-[0.32em] ${className}`}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(12px)",
        transition: `opacity ${RISE_MS}ms ease ${d}ms, transform ${RISE_MS}ms ease ${d}ms`,
      }}
    >
      <div className="flex h-[1em] items-center">{graphic}</div>
      <div className="whitespace-nowrap font-medium leading-none">{value}</div>
      <div className={LABEL}>{label}</div>
    </div>
  );
}

const LABEL = "whitespace-nowrap text-[11px] uppercase leading-none tracking-[0.14em] text-white/55 md:text-xs";
// Rule between cells, and the padding either side of it — in em, so it scales
// with the figures.
const RULE = "border-l border-white/20 pl-[0.6em]";
const GAP = "pr-[0.6em]";

/** "Sat 12:41 AM" — the visitor's own clock, ticking. */
function useClock() {
  const fmt = () =>
    new Date().toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setNow(fmt()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** One sentence carrying the same facts, for screen readers. */
function summary(place: string | null, w: Weather | null) {
  const parts: string[] = [];
  if (place) parts.push(place);
  if (w) {
    parts.push(`${w.temp}°${w.unit} and ${w.label.toLowerCase()}`);
    if (w.high !== null && w.low !== null) parts.push(`high ${w.high}°, low ${w.low}°`);
    if (w.rain !== null) parts.push(`${w.rain}% chance of rain`);
    if (w.wind) parts.push(`wind ${w.wind.speed} ${w.wind.unit} from the ${w.wind.from}`);
    for (const d of w.days) parts.push(`${d.day} ${d.high}°`);
  }
  return parts.join(". ") + ".";
}

export default function WeatherPanel({
  place,
  weather: w,
  shown,
  size,
}: {
  place: string | null;
  weather: Weather | null;
  shown: boolean;
  /** Font size of the figures (any CSS length); everything else is in em. */
  size: string;
}) {
  const clock = useClock();
  // Armed a frame after mounting. The panel usually mounts already `shown`
  // (the lookup tends to land after the fonts), and anything that starts out
  // in its end state has nothing to transition from — no rise, no draw-on.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setArmed(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);
  if (!place && !w) return null;
  const on = shown && armed;
  const at = (i: number) => i * STEP_MS;

  return (
    <div className={on ? "wx-on" : undefined} style={{ fontSize: size }}>
      <p className="sr-only">{summary(place, w)}</p>
      <div aria-hidden>
        {/* Dateline: the place and the visitor's own time. */}
        <div
          className="mb-[0.75em] flex items-center gap-2 text-[15px] text-white/75 md:text-base"
          style={{
            opacity: on ? 1 : 0,
            transform: on ? "none" : "translateY(12px)",
            transition: `opacity ${RISE_MS}ms ease, transform ${RISE_MS}ms ease`,
          }}
        >
          <svg {...svgProps} className="wx-draw size-[1.15em] shrink-0">
            <path
              d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"
              pathLength={1}
            />
            <circle cx="12" cy="10" r="3" pathLength={1} />
          </svg>
          {place && <span>{place}</span>}
          {place && <span className="text-white/35">/</span>}
          <span>{clock}</span>
        </div>

        {w && (
          // Phones: three columns, the forecast taking two on the second row.
          // md up: one row, ruled between cells.
          <div className="grid grid-cols-3 gap-y-[0.8em] md:flex md:gap-y-0">
            <Cell
              i={1}
              shown={on}
              className={GAP}
              graphic={<Icon kind={w.icon} className="h-full w-auto" delay={at(1)} />}
              value={
                <>
                  <Count to={w.temp} shown={on} delay={at(1)} />°
                </>
              }
              label={w.label}
            />
            {w.high !== null && w.low !== null && (
              <Cell
                i={2}
                shown={on}
                className={`${RULE} ${GAP} md:w-[4.6em]`}
                graphic={<RangeBar low={w.low} high={w.high} now={w.temp} shown={on} delay={at(2)} />}
                value={
                  <>
                    <Count to={w.high} shown={on} delay={at(2)} />°
                    <span className="text-white/45">
                      {" / "}
                      <Count to={w.low} shown={on} delay={at(2)} />°
                    </span>
                  </>
                }
                label="High / Low"
              />
            )}
            {w.rain !== null && (
              <Cell
                i={3}
                shown={on}
                className={`${RULE} md:pr-[0.6em]`}
                graphic={<RainGauge pct={w.rain} shown={on} delay={at(3)} />}
                value={
                  <>
                    <Count to={w.rain} shown={on} delay={at(3)} />%
                  </>
                }
                label="Rain chance"
              />
            )}
            {w.wind && (
              <Cell
                i={4}
                shown={on}
                className={`${GAP} md:border-l md:border-white/20 md:pl-[0.6em]`}
                graphic={<WindDial deg={w.wind.deg} shown={on} delay={at(4)} />}
                value={
                  <>
                    <Count to={w.wind.speed} shown={on} delay={at(4)} />
                    <span className="text-[0.55em] text-white/70"> {w.wind.unit}</span>
                  </>
                }
                label={`Wind ${w.wind.from}`}
              />
            )}
            {w.days.length > 0 && (
              <div
                className={`col-span-2 flex gap-[0.55em] ${RULE}`}
                style={{
                  opacity: on ? 1 : 0,
                  transform: on ? "none" : "translateY(12px)",
                  transition: `opacity ${RISE_MS}ms ease ${at(5)}ms, transform ${RISE_MS}ms ease ${at(5)}ms`,
                }}
              >
                {w.days.map((d, k) => (
                  <div key={d.day} className="flex flex-col gap-[0.32em]">
                    <div className="flex h-[1em] items-center">
                      <Icon kind={d.icon} className="h-[0.8em] w-auto" delay={at(5) + k * 120} />
                    </div>
                    <div className="whitespace-nowrap font-medium leading-none">
                      {d.high}°<span className="text-[0.6em] text-white/45"> {d.low}°</span>
                    </div>
                    <div className={LABEL}>{d.day}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
