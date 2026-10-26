/**
 * Wide-display breathing room for the left rail.
 *
 * The rail is a flat quarter of the window, with its content starting at the
 * window's own edge. That reads fine at laptop widths and badly past about
 * 1500px, where the content ends up pinned into the corner with a very wide
 * gallery beside it.
 *
 * Past WIDE_MIN the rail claims a little extra width and spends *all* of it on
 * a left inset, so the content column keeps exactly the width it had at a flat
 * quarter and simply sits further in — the gallery beside it gets
 * correspondingly narrower. Two smaller adjustments ride the same ramp: the
 * prev/next chevrons pull further from the rail's right edge, and the list's
 * type grows, since at these widths the old size was small against the brand
 * block above it.
 *
 * Ramped rather than switched at a breakpoint on purpose: the rail's width
 * sets the canvas width, so a step change would reallocate the drawing buffer
 * and jump the teaser mid-resize.
 */

/** The rail's share of the window in landscape, before any wide-display inset. */
export const RAIL_FRACTION = 0.25;

// Nothing below this width has room to give away; everything is at full
// strength from WIDE_FULL up, rather than drifting further out forever.
const WIDE_MIN = 1500;
const WIDE_FULL = 2000;

const INSET_MAX = 88; // extra rail width, all of it spent on the left inset
const CHEV_INSET_MAX = 24; // extra gap between the chevrons and the rail's edge
const LIST_FONT_MAX = 5; // px added to the project list's type

function ramp(width: number, isLandscape: boolean) {
  if (!isLandscape || width <= WIDE_MIN) return 0;
  return Math.min(1, (width - WIDE_MIN) / (WIDE_FULL - WIDE_MIN));
}

export function railMetrics(width: number, isLandscape: boolean) {
  const t = ramp(width, isLandscape);
  return {
    /** Added to the rail's width and to its content's left padding alike. */
    inset: Math.round(INSET_MAX * t),
    /** Added to the chevrons' inset from the rail's right edge. */
    chevInset: Math.round(CHEV_INSET_MAX * t),
    /** Added to the project list's font size. */
    fontBump: Math.round(LIST_FONT_MAX * t),
  };
}

/** The rail's width in landscape — a quarter of the window plus the inset. */
export function railWidth(width: number, isLandscape: boolean) {
  return width * RAIL_FRACTION + railMetrics(width, isLandscape).inset;
}
