/**
 * Single source of truth for gallery scrolling. Input handlers push pixels
 * into `target`; the render loop calls `update()` each frame, easing
 * `current` toward `target` and exposing per-frame `velocity` for the
 * bend distortion. Scroll distance is measured along the active axis
 * (vertical in landscape, horizontal in portrait) with one item per
 * `spacing` pixels, wrapped infinitely by the scene.
 */
export class ScrollEngine {
  target = 0;
  current = 0;
  velocity = 0;
  spacing = 1;
  count = 1;

  private inputHeld = false;
  private lastInputTime = -Infinity;

  // Both of these are per-frame exponential coefficients, so the settle time
  // scales as roughly 1/k — doubling them halves the tail. Measured: a
  // one-item snap took ~1.7s at 0.08/0.1, which read as a long drift after the
  // motion had visually stopped; 0.16/0.2 halved that, and these values take
  // another third off as part of the site-wide tightening.
  private static readonly EASE = 0.22;
  // Snap blending: while input is idle, the target itself glides toward the
  // nearest item center each frame. Because `current` is still easing toward
  // that (moving) target, the slow-down and the snap fuse into one motion
  // instead of a stop followed by a second animation.
  private static readonly SNAP_EASE = 0.27;
  private static readonly SNAP_IDLE_MS = 80;

  setLayout(spacing: number, count: number) {
    if (spacing > 0 && this.spacing > 0 && spacing !== this.spacing) {
      // Keep the same item centered when the axis length changes on resize
      // or orientation flip.
      const factor = spacing / this.spacing;
      this.target *= factor;
      this.current *= factor;
    }
    this.spacing = spacing;
    this.count = count;
  }

  reset() {
    this.target = 0;
    this.current = 0;
    this.velocity = 0;
  }

  /** Call on every wheel tick so snapping holds off while input is live. */
  notifyInput() {
    this.lastInputTime = performance.now();
  }

  /** Call on drag start/end; snapping is suppressed while held. */
  setInputHeld(held: boolean) {
    this.inputHeld = held;
    this.lastInputTime = performance.now();
  }

  update() {
    if (
      !this.inputHeld &&
      performance.now() - this.lastInputTime > ScrollEngine.SNAP_IDLE_MS
    ) {
      const snapped = Math.round(this.target / this.spacing) * this.spacing;
      this.target += (snapped - this.target) * ScrollEngine.SNAP_EASE;
    }
    const next = this.current + (this.target - this.current) * ScrollEngine.EASE;
    this.velocity = next - this.current;
    this.current = next;
  }

  /**
   * True once the strip has genuinely stopped on an item centre — not merely
   * slowed down. Gates teaser video, which must never share a frame with the
   * scroll animation. The tolerances are deliberately tight: at landscape
   * spacing the old 0.02 allowed ~19px of drift and 0.5 allowed a visible
   * 30px/s creep, so video could run through the whole tail of a fling.
   */
  get settled() {
    if (this.spacing <= 0) return false;
    const p = this.current / this.spacing;
    return Math.abs(p - Math.round(p)) < 0.004 && Math.abs(this.velocity) < 0.08;
  }

  get activeIndex() {
    const raw = Math.round(this.current / this.spacing) % this.count;
    return raw < 0 ? raw + this.count : raw;
  }

  /**
   * Advance by whole items, for the menu's prev/next chevrons. Steps from the
   * *snapped* target rather than the raw one, so a click lands on an exact
   * item centre even mid-glide — and so repeated clicks accumulate one item
   * each instead of compounding a fractional offset.
   */
  stepItems(delta: number) {
    if (this.spacing <= 0) return;
    const snapped = Math.round(this.target / this.spacing) * this.spacing;
    this.target = snapped + delta * this.spacing;
  }

  scrollToIndex(index: number) {
    const total = this.count * this.spacing;
    const base = index * this.spacing;
    // Travel to the nearest wrapped copy of the requested item.
    const wraps = Math.round((this.current - base) / total);
    this.target = base + wraps * total;
  }
}
