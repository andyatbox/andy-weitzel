/**
 * What the two portfolios *are*: their ids, what they are called, and the
 * Sanity categories they map onto.
 *
 * Apart from the hooks next door in lib/portfolios, which fetch them, because
 * this has to be readable on the server — the route segment validates an
 * address and titles a page from it — and a module that imports a React hook
 * cannot be. lib/portfolios re-exports all of it, so client code can go on
 * importing from the one place.
 */

// The ids are the originals and stay: they are what the Sanity category map
// below is keyed by. The label and the URL segment both read "experiential".
export type PortfolioId = "interactive" | "branding";

export const PORTFOLIO_IDS: PortfolioId[] = ["interactive", "branding"];

export const LABELS: Record<PortfolioId, string> = {
  interactive: "Experiential",
  branding: "Branding",
};

// Our app portfolios map onto Sanity category values. The dataset may still
// hold `advertising-rich-media` projects; with no id mapped to it they're
// simply dropped from the fetch in lib/portfolios.
export const CATEGORY: Record<PortfolioId, string> = {
  interactive: "immersive-ux",
  branding: "branding-print",
};

export const ID_BY_CATEGORY: Record<string, PortfolioId | undefined> =
  Object.fromEntries(PORTFOLIO_IDS.map((id) => [CATEGORY[id], id]));
