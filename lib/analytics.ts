/**
 * Google Tag Manager, as the two things the site has to do about it: load the
 * container (app/layout.tsx) and say when the page has changed (here).
 *
 * Nothing on this site ever reloads — every move is a History API push inside
 * one mounted app — so the container's own page view only ever fires for the
 * URL the visitor arrived on. Every move after that pushes `virtual_page_view`
 * with the new path, which a GA4 tag in the container can trigger on. GTM's
 * built-in History Change trigger sees the same moves, so either wiring
 * works; this one is explicit and carries the title with it.
 */
export const GTM_ID = "GTM-MW6WRSPJ";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Tell the container the visitor is on a new page. */
export function pageView(path: string, title: string) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: "virtual_page_view",
    page_path: path,
    page_title: title,
    page_location: window.location.href,
  });
}
