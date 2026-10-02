/**
 * The gallery teasers' pointer and motion colour-split effect, as numbers.
 *
 * Shared rather than copied: the landing blob renders the *same* effect as the
 * teasers, and two sets of constants would drift apart the first time either
 * was tuned.
 *
 * Pointer: a localized swirl + chromatic split centred on the cursor — full
 * strength directly under it, smoothstepped to nothing at the radius.
 * Motion: the red and blue layers slide apart along the direction of travel,
 * in proportion to speed; green stays put, so all three realign and sum back
 * to the original picture at rest.
 *
 * Desktop only: completely disabled on touch-capable devices (`detectTouch`).
 */
export const MOUSE_RADIUS_RATIO = 0.3; // influence radius vs min(canvas w, h)
export const MOUSE_TWIST = 0.85; // peak swirl angle in radians (directly under cursor)
export const MOUSE_CHROMA_RATIO = 0.018; // peak channel separation vs min(canvas w, h)
export const MOUSE_EASE = 0.22; // strength lerp toward target each frame

export const RGB_SHIFT_FACTOR = 1.5; // channel slide per unit of velocity
export const MAX_RGB_SHIFT_RATIO = 0.025; // cap, vs the moving thing's size

export function detectTouch() {
  if (typeof window === "undefined") return false;
  return (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
}
