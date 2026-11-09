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
