/**
 * The project tags, as the Sanity studio defines them.
 *
 * The dataset stores slugs, never labels — that is what makes rewording a tag
 * a one-line change instead of a migration — so the words a visitor reads
 * have to live somewhere, and this is the somewhere. Keep the list in step
 * with `tags` in the studio's `project` schema (the box-creative repo); a slug
 * that arrives without an entry here still shows, title-cased, rather than
 * disappearing from the filter row.
 *
 * The order is the studio's own, and it is what the filter row follows: the
 * row is not sorted by how many projects carry each tag, because a row that
 * reshuffles itself as projects are tagged is a row nobody can learn.
 */
export const TAGS: readonly { value: string; label: string }[] = [
  { value: "activation", label: "Activation" },
  { value: "app-development", label: "App Development" },
  { value: "artificial-intelligence", label: "Artificial Intelligence" },
  { value: "augmented-reality", label: "Augmented Reality" },
  { value: "brand-identity-logo", label: "Brand Identity & Logo" },
  { value: "cgi-3d-design", label: "CGI / 3D Design" },
  { value: "copywriting", label: "Copywriting" },
  { value: "illustration", label: "Illustration" },
  { value: "immersive-experience", label: "Immersive Experience" },
  { value: "store-design", label: "Store Design" },
  { value: "marketing-strategy", label: "Marketing Strategy" },
  { value: "motion-animation", label: "Motion & Animation" },
  { value: "print-packaging", label: "Print & Packaging" },
  { value: "product-design", label: "Product Design" },
  { value: "rich-media-ads", label: "Rich Media Ads" },
  { value: "web-design-ux", label: "Web Design & UX" },
];

const LABEL = new Map(TAGS.map((t) => [t.value, t.label]));
const RANK = new Map(TAGS.map((t, i) => [t.value, i]));

/** A tag's words. An unknown slug is title-cased rather than dropped. */
export function tagLabel(value: string): string {
  return (
    LABEL.get(value) ??
    value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * The tags actually carried by `items`, in the studio's order, with anything
 * unrecognised after them.
 *
 * Scoped to what is in front of the visitor rather than to the whole schema:
 * the filter row belongs to one portfolio at a time, and a pill that can only
 * ever empty the grid is worse than no pill at all.
 */
export function tagsPresent(items: { tags?: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const item of items) for (const t of item.tags ?? []) seen.add(t);
  return [...seen].sort((a, b) => {
    const ra = RANK.get(a) ?? Infinity;
    const rb = RANK.get(b) ?? Infinity;
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
}

/**
 * Whether an item survives the current selection: a **union**. Any one of the
 * selected tags is enough, so a second pill adds work to the grid rather than
 * cutting it down.
 *
 * An intersection was tried, and the tagging here is what rules it out. These
 * are facets of one piece of work rather than a search — most projects carry
 * five or six of them, and the overlap of any two specific ones is one or two
 * projects when it isn't empty. A row where half the second clicks leave you
 * with nothing, or with a single teaser, teaches people to stop clicking. The
 * question this row answers is "show me the AR work, and the illustration
 * work", not "show me what is both".
 */
export function matchesTags(item: { tags?: string[] }, selected: string[]) {
  if (selected.length === 0) return true;
  const tags = item.tags;
  if (!tags?.length) return false;
  return selected.some((t) => tags.includes(t));
}
