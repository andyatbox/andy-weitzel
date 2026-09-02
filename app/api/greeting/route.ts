import { NextResponse, type NextRequest } from "next/server";

/**
 * Loose "where you are, roughly" for the landing agent: the visitor's city and
 * a plain-language read on the weather. Both are optional — the copy is
 * written to degrade rather than to depend on them.
 *
 * Geolocation is free and needs no third party: Vercel puts it on every
 * request. Weather comes from Open-Meteo, which needs no API key either.
 */

// Forecast models to consult. See the fetch below for why more than one.
const MODELS = ["best_match", "icon_seamless", "gfs_seamless"] as const;

// Per-visitor by definition, so this response must never be shared between
// them. Next's fetch cache has already burned this codebase once (the
// video-poster route served stale upstream data for a whole window) — only the
// Open-Meteo call below is cached, and that's keyed by coordinate.
export const dynamic = "force-dynamic";

/**
 * One adjective for the weather, chosen by what a person would actually lead
 * with: anything falling from the sky first, then a temperature worth
 * remarking on, then rain that's coming, then the sky itself. Pairing
 * temperature *and* sky (as this used to) meant overcast — far and away the
 * most common code — turned up in nearly every greeting.
 */
function condition(
  skyCode: number | null,
  wetCode: number | null,
  precipNow: number,
  f: number | null,
  humidity: number | null,
  rainSoon: boolean,
  isDay: boolean
): string | null {
  const code = wetCode;
  if (code !== null) {
    if (code >= 95) return "stormy";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
    if (code >= 51 && code <= 57) return "drizzly";
    if (code === 45 || code === 48) return "foggy";
  }
  // Measured precipitation with no matching code: still wet.
  if (precipNow > 0) return "rainy";
  if (f !== null && f < 20) return "frigid";
  if (f !== null && f < 38) return "cold";
  if (rainSoon) return "soon-to-be rainy";
  if (f !== null && f >= 88) return "hot";
  if (humidity !== null && humidity >= 70 && f !== null && f >= 74) return "humid";
  if (skyCode === 0 || skyCode === 1) return isDay ? "sunny" : "clear";
  if (skyCode === 2) return "partly cloudy";
  if (skyCode === 3) return "overcast";
  if (f === null) return null;
  if (f < 52) return "cool";
  if (f < 76) return "mild";
  return "warm";
}

/**
 * How wet a WMO code is, so the worst reading across the models below wins.
 * 0 means "nothing falling".
 */
function wetRank(code: number): number {
  if (code >= 95) return 5;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 4;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 3;
  if (code >= 51 && code <= 57) return 2;
  if (code === 45 || code === 48) return 1;
  return 0;
}

/**
 * Season as a person would say it — "late-summer", not "Q3". Astronomical
 * boundaries rather than meteorological ones, because in early September
 * people still say late summer, not early autumn. Each season is split into
 * thirds for the early/mid/late qualifier.
 */
function seasonName(lat: number, d = new Date()): string {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start) / 86_400_000);
  // Northern-hemisphere season starts, by day of year.
  const marks: [number, string][] = [
    [79, "spring"],
    [172, "summer"],
    [265, "fall"],
    [355, "winter"],
  ];
  let name = "winter";
  let from = 355 - 365; // winter began late last year
  let to = 79;
  for (let i = 0; i < marks.length; i++) {
    const [mStart, mName] = marks[i];
    const next = i + 1 < marks.length ? marks[i + 1][0] : 365 + 79;
    if (doy >= mStart && doy < next) {
      name = mName;
      from = mStart;
      to = next;
      break;
    }
  }
  // South of the equator the same date is the opposite season.
  if (lat < 0) {
    name = { spring: "fall", summer: "winter", fall: "spring", winter: "summer" }[
      name
    ]!;
  }
  const through = (doy - from) / Math.max(1, to - from);
  const phase = through < 1 / 3 ? "early" : through < 2 / 3 ? "mid" : "late";
  return `${phase}-${name}`;
}

// US state codes, the only subdivisions worth naming in an English sentence:
// elsewhere the ISO code is either opaque ("IDF") or numeric ("75"), so those
// visitors get their country instead.
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

// Country names that need an article to sit in "…night in ___".
const NEEDS_THE = /^(United |Netherlands|Philippines|Bahamas|Maldives|Czech)/;

/**
 * The place worth naming: a US state, otherwise the country. Both are far more
 * reliable than the city field, which reports where the ISP hands off — two
 * devices in the same house resolved to Queens and to Lynbrook, and neither
 * was right. State and country were correct for both.
 */
function placeName(countryCode: string | null, regionCode: string | null): string | null {
  if (countryCode === "US" && regionCode) return US_STATES[regionCode] ?? null;
  if (!countryCode) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode);
    if (!name || name === countryCode) return null;
    return NEEDS_THE.test(name) ? `the ${name}` : name;
  } catch {
    return null;
  }
}

export interface Greeting {
  /** e.g. "Brooklyn" — city-level at best, and usually wrong. Unused in copy. */
  city: string | null;
  /** e.g. "New York" or "France" — the granularity that's actually reliable. */
  place: string | null;
  /** A single adjective, e.g. "overcast" or "soon-to-be rainy". */
  weather: string | null;
  /** Rounded and formatted, e.g. "76°F". */
  temp: string | null;
  /** e.g. "late-summer" — hemisphere-aware. */
  season: string | null;
}

export async function GET(req: NextRequest) {
  const h = req.headers;
  // Vercel percent-encodes these ("New%20York").
  const raw = h.get("x-vercel-ip-city");
  let city: string | null = null;
  if (raw) {
    try {
      city = decodeURIComponent(raw) || null;
    } catch {
      city = raw;
    }
  }
  let lat = h.get("x-vercel-ip-latitude");
  let lon = h.get("x-vercel-ip-longitude");
  let country = h.get("x-vercel-ip-country");
  let region = h.get("x-vercel-ip-country-region");

  // Those headers only exist on Vercel, so locally there is nothing to read.
  // Stand in for them off-production so the full copy path is actually
  // developable instead of only ever showing the fallback.
  if (!lat && !lon && process.env.NODE_ENV !== "production") {
    city = city ?? "Brooklyn";
    lat = "40.6782";
    lon = "-73.9442";
    country = country ?? "US";
    region = region ?? "NY";
  }

  let weather: string | null = null;
  let temp: string | null = null;
  let season: string | null = null;
  // Why a read failed, surfaced only via ?debug=1. Weather depends on headers
  // and an upstream that behave differently in production than they do
  // locally, and without this the only symptom is a silent fallback.
  let why = "ok";
  if (!lat || !lon) why = "no-coords";
  if (lat && lon) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=temperature_2m,weather_code,relative_humidity_2m,is_day` +
      // Three models rather than one. The default blend misses light rain that
      // others catch — checked against a wet afternoon in Brooklyn where
      // best_match, HRRR and ECMWF all reported plain overcast and ICON alone
      // reported 0.3mm. Telling someone it's overcast while they're getting
      // wet is a worse error than the reverse, so anything falling in any
      // model counts. `current` doesn't split by model; `hourly` does.
      `&hourly=weather_code,precipitation,precipitation_probability` +
      `&models=${MODELS.join(",")}&forecast_hours=6` +
      `&temperature_unit=fahrenheit`;
    // Open-Meteo intermittently answers 200 with a plain-text upstream error
    // ("timeoutReached") instead of JSON — observed several times in a row
    // while building this. So: a bounded timeout, and one retry, before
    // giving up and letting the copy do without.
    for (let attempt = 0; attempt < 2 && weather === null; attempt++) {
      try {
        // Keyed by coordinate, so a short shared cache is safe here in a way
        // the response as a whole is not — but kept brief, because rain starts
        // inside a ten-minute window.
        // The retry deliberately skips the cache. Open-Meteo answers 200 with
        // a plain-text error often enough that it matters, and Next caches a
        // 200 whatever the body is — so a single bad reply would otherwise be
        // served to every visitor for the whole revalidate window, with the
        // retry hitting that same poisoned entry and changing nothing. That is
        // exactly the shape of "no weather at all, for everyone, for minutes".
        const res = await fetch(url, {
          ...(attempt === 0
            ? { next: { revalidate: 300 } }
            : { cache: "no-store" as const }),
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) {
          why = `upstream-${res.status}`;
          continue;
        }
        const data = (await res.json()) as {
          current?: {
            temperature_2m?: number;
            weather_code?: number;
            relative_humidity_2m?: number;
            is_day?: number;
          };
          hourly?: Record<string, (number | null)[]>;
        };
        const c = data.current ?? {};
        const h = data.hourly ?? {};
        const num = (v: unknown) => (typeof v === "number" ? v : null);

        // Union across the models: the wettest code anyone reports for this
        // hour, and the most precipitation anyone measures.
        let wetCode: number | null = null;
        let wetBest = 0;
        let precipNow = 0;
        let probSoon = 0;
        for (const m of MODELS) {
          const code = num(h[`weather_code_${m}`]?.[0]);
          if (code !== null && wetRank(code) > wetBest) {
            wetBest = wetRank(code);
            wetCode = code;
          }
          precipNow = Math.max(precipNow, num(h[`precipitation_${m}`]?.[0]) ?? 0);
          // From the *next* hour on, so "coming later" never describes now.
          const probs = h[`precipitation_probability_${m}`] ?? [];
          for (let i = 1; i < probs.length; i++) {
            probSoon = Math.max(probSoon, num(probs[i]) ?? 0);
          }
        }

        const isDay = c.is_day !== 0;
        const cond = condition(
          num(c.weather_code),
          wetCode,
          precipNow,
          num(c.temperature_2m),
          num(c.relative_humidity_2m),
          probSoon >= 55,
          isDay
        );
        if (!cond) why = "no-condition";
        if (cond) {
          weather = cond;
          if (typeof c.temperature_2m === "number")
            temp = `${Math.round(c.temperature_2m)}°F`;
          season = seasonName(Number(lat));
        }
      } catch (e) {
        // Non-JSON body, timeout, or network — try once more, then give up.
        why = `threw-${e instanceof Error ? e.name : "unknown"}`;
      }
    }
  }

  const body: Greeting & Record<string, unknown> = {
    city,
    place: placeName(country, region),
    weather,
    temp,
    season,
  };
  if (req.nextUrl.searchParams.get("debug") === "1") {
    body.debug = { why, lat, lon, country, region };
  }
  return NextResponse.json(body);
}
