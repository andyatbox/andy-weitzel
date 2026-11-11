import type { Route } from "./routes";

/**
 * Google Analytics 4, as the two things the site has to do about it: load
 * gtag (app/layout.tsx) and say when the page has changed (here).
 *
 * Measured directly rather than through a Tag Manager container. A container
 * is worth its weight when tags come and go without a deploy; here there is
 * one tag, it is this one, and routing it through GTM would mean the only
 * way to turn analytics on is a settings screen somewhere outside the repo.
 * If marketing tags ever need to be added without shipping code, the
 * container id is GTM-MW6WRSPJ and this is where it would go back.
 *
 * Nothing on this site ever reloads — every move is a History API push inside
 * one mounted app — so gtag's own page view only ever fires for the URL the
 * visitor arrived on. Every move after that is sent from here.
 */
export const GA_ID = "G-X2D07YJG44";

/**
 * Whether a move is worth recording as a page view.
 *
 * Closing a project, or an overlay, lands back on the page it was opened
 * over. Counting that would have a portfolio outscore every project on it
 * several times over — not because anyone sought the portfolio out, but
 * because it is the thing you pass back through on the way to the next
 * project. The arrival counts; the way back does not.
 *
 * Everything else is a real move and counts, including one portfolio to
 * another, and a project to a project.
 */
export function isPageViewWorthy(prev: Route, next: Route): boolean {
  if (prev.portfolio !== next.portfolio) return true;
  // Something is being opened, not closed.
  if (next.slug || next.panel) return true;
  // Nothing was open to close, so this is a move in its own right.
  return !prev.slug && !prev.panel;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Record that the visitor is on a new page.
 *
 * `page_location` has to be passed: gtag remembers the URL it was configured
 * with and would otherwise report every move as the address the visitor
 * arrived on.
 */
export function pageView(path: string, title: string) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_title: title,
    page_location: window.location.origin + path,
  });
}
