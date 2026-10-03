import { NextResponse, type NextRequest } from "next/server";

/**
 * Loose "where you are, roughly" for the landing: the visitor's state or
 * country and the local weather, drawn as a row of small data graphics above
 * the greeting. Both are optional — the landing degrades rather than depends
 * on them.
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

/** Which pictogram a WMO weather code gets (see components/WeatherPanel). */
export type WeatherIcon =
  | "clear-day"
  | "clear-night"
  | "partly-day"
  | "partly-night"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

function iconFor(code: number, isDay: boolean): WeatherIcon {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloudy";
  if (code === 2) return isDay ? "partly-day" : "partly-night";
  return isDay ? "clear-day" : "clear-night";
}

function labelFor(code: number): string {
  if (code >= 95) return "Thunderstorm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code === 45 || code === 48) return "Fog";
  if (code === 3) return "Overcast";
  if (code === 2) return "Partly cloudy";
  if (code === 1) return "Mostly clear";
  return "Clear";
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// Where people read Fahrenheit and miles an hour. Everyone else gets Celsius
// and km/h.
const IMPERIAL = new Set(["US", "PR", "GU", "VI", "AS", "MP", "LR", "BS", "KY", "PW", "FM", "MH", "BZ"]);

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
    return name;
  } catch {
    return null;
  }
}

export interface Weather {
  unit: "F" | "C";
  /** Now, rounded. */
  temp: number;
  icon: WeatherIcon;
  /** e.g. "Overcast". */
  label: string;
  /** Today's range, at the visitor's location. */
  high: number | null;
  low: number | null;
  /** Highest chance of precipitation over the next 12 hours, 0..100. */
  rain: number | null;
  wind: { speed: number; unit: "mph" | "km/h"; deg: number; from: string } | null;
  /** The next three days. */
  days: { day: string; icon: WeatherIcon; high: number; low: number }[];
}

export interface Greeting {
  /** e.g. "New York" or "France" — the granularity that's actually reliable. */
  place: string | null;
  weather: Weather | null;
}

export async function GET(req: NextRequest) {
  const h = req.headers;
  let lat = h.get("x-vercel-ip-latitude");
  let lon = h.get("x-vercel-ip-longitude");
  let country = h.get("x-vercel-ip-country");
  let region = h.get("x-vercel-ip-country-region");

  // Those headers only exist on Vercel, so locally there is nothing to read.
  // Stand in for them off-production so the full path is actually
  // developable instead of only ever showing the fallback.
  if (!lat && !lon && process.env.NODE_ENV !== "production") {
    lat = "40.6782";
    lon = "-73.9442";
    country = country ?? "US";
    region = region ?? "NY";
  }

  const imperial = country ? IMPERIAL.has(country) : true;
  const deg = (f: number) => Math.round(imperial ? f : ((f - 32) * 5) / 9);

  let weather: Weather | null = null;
  // Why a read failed, surfaced only via ?debug=1. Weather depends on headers
  // and an upstream that behave differently in production than they do
  // locally, and without this the only symptom is a silent fallback.
  let why = "ok";
  if (!lat || !lon) why = "no-coords";
  if (lat && lon) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m` +
      // Three models rather than one. The default blend misses light rain that
      // others catch — checked against a wet afternoon in Brooklyn where
      // best_match, HRRR and ECMWF all reported plain overcast and ICON alone
      // reported 0.3mm. Telling someone it's overcast while they're getting
      // wet is a worse error than the reverse, so anything falling in any
      // model counts. `current` doesn't split by model; `hourly` and `daily`
      // do (suffixed with the model name).
      `&hourly=weather_code,precipitation,precipitation_probability` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&models=${MODELS.join(",")}&forecast_hours=12&forecast_days=4` +
      // Days and "today" in the visitor's own calendar, not UTC's.
      `&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    // Open-Meteo intermittently answers 200 with a plain-text upstream error
    // ("timeoutReached") instead of JSON — observed several times in a row
    // while building this. So: a bounded timeout, and one retry, before
    // giving up and letting the landing do without.
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
            is_day?: number;
            wind_speed_10m?: number;
            wind_direction_10m?: number;
          };
          hourly?: Record<string, (number | null)[]>;
          daily?: Record<string, (number | string | null)[]>;
        };
        const c = data.current ?? {};
        const hr = data.hourly ?? {};
        const dy = data.daily ?? {};
        const num = (v: unknown) => (typeof v === "number" ? v : null);

        // Union across the models: the wettest code anyone reports for this
        // hour, anything measurably falling, and the highest chance anyone
        // gives over the coming hours.
        let wetCode: number | null = null;
        let wetBest = 0;
        let precipNow = 0;
        let rain: number | null = null;
        for (const m of MODELS) {
          const code = num(hr[`weather_code_${m}`]?.[0]);
          if (code !== null && wetRank(code) > wetBest) {
            wetBest = wetRank(code);
            wetCode = code;
          }
          precipNow = Math.max(precipNow, num(hr[`precipitation_${m}`]?.[0]) ?? 0);
          for (const p of hr[`precipitation_probability_${m}`] ?? []) {
            const v = num(p);
            if (v !== null) rain = Math.max(rain ?? 0, v);
          }
        }

        const t = num(c.temperature_2m);
        const sky = num(c.weather_code);
        if (t === null || sky === null) {
          why = "no-current";
          continue;
        }
        const isDay = c.is_day !== 0;
        // Wet beats the sky; measured precipitation with no matching code is
        // still rain.
        const code = wetCode ?? (precipNow > 0 ? 61 : sky);

        // The forecast days, from the default model.
        const dailyNum = (key: string, i: number) => num(dy[`${key}_best_match`]?.[i]);
        const days: Weather["days"] = [];
        const dates = dy.time ?? [];
        for (let i = 1; i < dates.length && days.length < 3; i++) {
          const date = dates[i];
          const dc = dailyNum("weather_code", i);
          const hi = dailyNum("temperature_2m_max", i);
          const lo = dailyNum("temperature_2m_min", i);
          if (typeof date !== "string" || dc === null || hi === null || lo === null) continue;
          days.push({
            // The date is already the visitor's local one; read it as UTC so
            // the server's own zone can't shift it a day.
            day: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
              weekday: "short",
              timeZone: "UTC",
            }),
            icon: iconFor(dc, true),
            high: deg(hi),
            low: deg(lo),
          });
        }

        const hi = dailyNum("temperature_2m_max", 0);
        const lo = dailyNum("temperature_2m_min", 0);
        const ws = num(c.wind_speed_10m);
        const wd = num(c.wind_direction_10m);
        weather = {
          unit: imperial ? "F" : "C",
          temp: deg(t),
          icon: iconFor(code, isDay),
          label: labelFor(code),
          // The range has to hold "now": early in the day the current reading
          // can sit outside a forecast that hasn't caught up with it yet.
          high: hi === null ? null : Math.max(deg(hi), deg(t)),
          low: lo === null ? null : Math.min(deg(lo), deg(t)),
          rain: rain === null ? null : Math.round(rain),
          wind:
            ws === null || wd === null
              ? null
              : {
                  speed: Math.round(imperial ? ws : ws * 1.609344),
                  unit: imperial ? "mph" : "km/h",
                  deg: wd,
                  from: COMPASS[Math.round(wd / 22.5) % 16],
                },
          days,
        };
      } catch (e) {
        // Non-JSON body, timeout, or network — try once more, then give up.
        why = `threw-${e instanceof Error ? e.name : "unknown"}`;
      }
    }
  }

  const body: Greeting & Record<string, unknown> = {
    place: placeName(country, region),
    weather,
  };
  if (req.nextUrl.searchParams.get("debug") === "1") {
    body.debug = { why, lat, lon, country, region };
  }
  return NextResponse.json(body);
}
