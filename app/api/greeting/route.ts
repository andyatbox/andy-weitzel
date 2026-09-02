import { NextResponse, type NextRequest } from "next/server";

/**
 * Loose "where you are, roughly" for the landing agent: the visitor's city and
 * a plain-language read on the weather. Both are optional — the copy is
 * written to degrade rather than to depend on them.
 *
 * Geolocation is free and needs no third party: Vercel puts it on every
 * request. Weather comes from Open-Meteo, which needs no API key either.
 */

// Per-visitor by definition, so this response must never be shared between
// them. Next's fetch cache has already burned this codebase once (the
// video-poster route served stale upstream data for a whole window) — only the
// Open-Meteo call below is cached, and that's keyed by coordinate.
export const dynamic = "force-dynamic";

// Sky, by WMO weather code — the vocabulary a person would actually use.
function skyWord(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "grey";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzly";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if (code >= 95) return "stormy";
  return "";
}

function tempWord(f: number): string {
  if (f < 25) return "frigid";
  if (f < 40) return "cold";
  if (f < 55) return "cool";
  if (f < 70) return "mild";
  if (f < 82) return "warm";
  return "hot";
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
  /** e.g. "cool, grey". Null whenever the lookup didn't work out. */
  weather: string | null;
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
  if (lat && lon) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    // Open-Meteo intermittently answers 200 with a plain-text upstream error
    // ("timeoutReached") instead of JSON — observed several times in a row
    // while building this. So: a bounded timeout, and one retry, before
    // giving up and letting the copy do without.
    for (let attempt = 0; attempt < 2 && weather === null; attempt++) {
      try {
        // Weather moves slowly and this is keyed by coordinate, so a short
        // shared cache is safe here in a way the response as a whole is not.
        const res = await fetch(url, {
          next: { revalidate: 600 },
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          current?: { temperature_2m?: number; weather_code?: number };
        };
        const t = data.current?.temperature_2m;
        const code = data.current?.weather_code;
        const sky = typeof code === "number" ? skyWord(code) : "";
        const temp = typeof t === "number" ? tempWord(t) : "";
        weather = [temp, sky].filter(Boolean).join(", ") || null;
      } catch {
        // Non-JSON body, timeout, or network — try once more, then give up.
      }
    }
  }

  return NextResponse.json({
    city,
    place: placeName(country, region),
    weather,
  } satisfies Greeting);
}
