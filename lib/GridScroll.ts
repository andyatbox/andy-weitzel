/**
 * The grid's scroll position, in world px from the top of the grid.
 *
 * Deliberately *not* the ScrollEngine. That engine's whole job is to land on
 * an item: it plans a quintic curve to the nearest one, wraps the strip, and
 * treats the list as endless. A grid has none of those properties — it has a
 * first row and a last row, several items abreast, and nothing to snap to —
 * and teaching the engine about bounds would mean touching the one file in
 * this codebase where every past fix broke a different gesture.
 *
 * So this is the small, dumb version: a target the input moves, a current
 * that chases it, and hard ends. It takes the same wheel and drag deltas, in
 * the same units, so the two feel like one scroll.
 */

/** Share of the remaining gap closed each frame. */
const CHASE = 0.16;
/** A release's fling velocity (px/frame) is worth this many px of travel. */
const FLING_REACH = 9;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export class GridScroll {
  target = 0;
  current = 0;
  /** px moved this frame — the gallery's bend and RGB shift read this. */
  velocity = 0;
  /** Furthest the grid can travel: content height less one canvas. */
  max = 0;

  /**
   * Both ends are hard. Rubber-banding past them would need a release to
   * spring back, which is a second animation to own; the grid is short
   * enough that hitting the end simply reads as the end.
   */
  input(delta: number) {
    this.target = clamp(this.target + delta, 0, this.max);
  }

  release(fling: number) {
    this.target = clamp(this.target + fling * FLING_REACH, 0, this.max);
  }

  setMax(max: number) {
    this.max = Math.max(0, max);
    this.target = clamp(this.target, 0, this.max);
    this.current = clamp(this.current, 0, this.max);
  }

  reset() {
    this.target = 0;
    this.current = 0;
    this.velocity = 0;
  }

  update() {
    const before = this.current;
    this.current += (this.target - this.current) * CHASE;
    if (Math.abs(this.target - this.current) < 0.01) this.current = this.target;
    this.velocity = this.current - before;
  }

  /** True once the chase has caught up and nothing is moving. */
  get settled() {
    return this.current === this.target;
  }
}
