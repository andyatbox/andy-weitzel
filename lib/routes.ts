import { LABELS, PORTFOLIO_IDS, type PortfolioId } from "./portfolioMeta";

/**
 * Every URL on the site, in one place:
 *
 *   /                            the landing gate
 *   /experiential                a portfolio
 *   /experiential/<slug>         one project
 *   /branding?panel=resume       an overlay, over the page it was opened from
 *
 * Plain data and plain functions, deliberately with no "use client": the
 * route segment reads this on the server to tell a real URL from a 404 and to
 * title the page, and the app reads the same thing in the browser to keep the
 * address bar in step with what is on screen.
 *
 * The overlays (resumé, contact, the reel) are a query rather than a path
 * because they cover something: a visitor who opens one and presses back
 * should be returned to the page underneath, not sent off it, and a link to
 * one should carry where it was opened from.
 */

/**
 * The segment each portfolio lives at. `interactive` is the old id — it is
 * what maps onto the Sanity category, so it stays — while `experiential` is
 * what the portfolio is called and what the URL says.
 */
export const PORTFOLIO_PATH: Record<PortfolioId, string> = {
  interactive: "experiential",
  branding: "branding",
};

const PORTFOLIO_BY_PATH: Record<string, PortfolioId | undefined> =
  Object.fromEntries(PORTFOLIO_IDS.map((id) => [PORTFOLIO_PATH[id], id]));

/** The three overlays that can sit over any page. */
export type Panel = "resume" | "contact" | "reel";
const PANELS: Panel[] = ["resume", "contact", "reel"];

export function asPanel(value: string | null | undefined): Panel | null {
  return PANELS.includes(value as Panel) ? (value as Panel) : null;
}

export interface Route {
  /** null is the landing gate. */
  portfolio: PortfolioId | null;
  /** A project inside that portfolio, or null for the gallery. */
  slug: string | null;
  panel: Panel | null;
}

export const LANDING: Route = { portfolio: null, slug: null, panel: null };

/** The path and query a route lives at. */
export function routeHref(route: Route): string {
  const path = route.portfolio
    ? `/${PORTFOLIO_PATH[route.portfolio]}${route.slug ? `/${route.slug}` : ""}`
    : "/";
  return route.panel ? `${path}?panel=${route.panel}` : path;
}

/**
 * Path segments to a route, or null if they name nothing here — which is what
 * the route segment turns into a 404. A project slug can't be checked without
 * the dataset, so any single segment under a portfolio parses here and the
 * app falls back to the portfolio if nothing carries that slug.
 */
export function routeFromSegments(segments: string[]): Route | null {
  if (segments.length === 0) return LANDING;
  if (segments.length > 2) return null;
  const portfolio = PORTFOLIO_BY_PATH[segments[0]];
  if (!portfolio) return null;
  return { portfolio, slug: segments[1] || null, panel: null };
}

/** The route the browser is at, read off the address bar. */
export function currentRoute(): Route {
  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const route = routeFromSegments(segments) ?? LANDING;
  const panel = asPanel(new URLSearchParams(window.location.search).get("panel"));
  return { ...route, panel };
}

const SITE = "Andy Weitzel";
const HOME_TITLE = "Andy Weitzel — Creative Director";

/**
 * A slug as a title. Only ever a stand-in: it titles the first paint of a
 * directly linked project, and the real title from the dataset replaces it as
 * soon as that arrives.
 */
export function prettySlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
}

/**
 * The document title for a route. `projectTitle` is the real one once the
 * dataset has answered; without it the slug stands in.
 */
export function routeTitle(route: Route, projectTitle?: string | null): string {
  if (!route.portfolio) return HOME_TITLE;
  const parts = [LABELS[route.portfolio], SITE];
  if (route.slug) parts.unshift(projectTitle || prettySlug(route.slug));
  return parts.join(" — ");
}
