/**
 * Single source of truth for gallery scrolling. Input handlers feed it scroll
 * input; the render loop calls `update()` each frame, which moves `current`
 * and exposes per-frame `velocity` for the bend distortion. Scroll distance is
 * measured along the active axis (vertical in landscape, horizontal in
 * portrait) with one item per `spacing` pixels, wrapped infinitely by the
 * scene.
 *
 * Scrolling ends on an item in one continuous motion. While input is live,
 * `current` chases `target`. The moment the input ends, the engine decides
 * where the scroll will come to rest and plans a single landing curve from the
 * current position — at the current speed *and* the current deceleration — to
 * that item, arriving with zero speed. Matching both means the hand-over from
 * the chase to the landing has no seam at all, not even a change in how hard
 * it's slowing.
 *
 * Where it rests is the item nearest where the input was headed (plus the
 * trackpad's or fling's remaining momentum) — with one exception: a gesture
 * deliberate enough to mean it always moves at least one item, however
 * short. The landing is then the gentlest clean curve to
 * it: the longest one that still runs only forward, so it eases out with a
 * long soft tail instead of braking. If even the shortest clean curve would
 * be too fast for the distance, it carries on to the next item — a hard flick
 * travels further rather than braking hard. It may only do that while that
 * next item is still within reach of where the input actually pointed:
 * momentum rounds, it doesn't invent travel. Unchecked, that one rule turned
 * most one-item scrolls into two.
 *
 * "The input ends" means different things per device:
 * - Mouse wheel: no notch for LANDING_IDLE_MS.
 * - Trackpad: after the fingers lift, the OS keeps sending a long tail of
 *   steadily shrinking events (momentum). That tail is recognised as it
 *   starts, its remaining distance is estimated, the landing is planned then,
 *   and the rest of the tail is absorbed. A fresh push cancels that and
 *   scrolling carries on.
 * - Drag / touch: on release (`release()`), including the fling.
 *
 * Tune by feeding input on a fake clock and checking the frame-by-frame speed
 * (it should only fall after its peak) — not by eye.
 */

// Live input: per-frame (at 60fps) share of the gap to `target` closed. Lower
// is softer and floatier; it also evens out the surge of each wheel notch.
const CHASE = 0.15;
// Wheel quiet time that counts as the end of a mouse-wheel gesture. Trackpad
// events arrive every frame, so this never fires mid-gesture for them.
const LANDING_IDLE_MS = 50;
// A gap this long between wheel events starts a new gesture.
const GESTURE_GAP_MS = 160;
// Trackpad momentum detection: this many consecutive shrinking deltas, after
// the gesture has fallen this far below its peak, is the OS's momentum tail
// rather than a finger.
const DECAY_RUN = 5;
const DECAY_FROM_PEAK = 0.75;
const MIN_PEAK = 6;
// Gliding landings leave at up to this many times their average speed — the
// longest, softest ease-out that still never runs backwards (a curve that
// leaves at more than 2.5× overshoots and comes back).
const GLIDE_SLOPE = 2.4;
// Landing duration bounds (s).
const T_MIN = 0.45;
const T_MAX = 1.2;
// When a gesture that doesn't reach the next item still means to go there,
// rather than being a nudge that should settle back where it was. Either:
// - it travels INTENT_TRAVEL of an item, counting momentum still to come, or
// - it's a mouse-wheel notch: its very first event is already NOTCH_PX or
//   more. A wheel delivers a whole notch at once (~100px, against ~950px
//   items on a desktop), while a trackpad always ramps up from small deltas —
//   so a light tap on a trackpad can't pass for one.
// Distance alone can't separate the two: a slight trackpad tap travels about
// as far as one notch, and with a low enough bar for the notch every tap
// moved on to the next teaser.
const INTENT_TRAVEL = 0.2;
const NOTCH_PX = 40;
// Below this speed (items per second) a landing that can't glide to rest in
// T_MIN just settles there; only above it does it carry on to the next item.
// Without a floor the rule fired on any motion at all — 22px/s over the last
// 3px counted as "too fast to stop" — and sent the gallery a whole item on.
const CARRY_MIN_SPEED = 1.5;
// How far the scroll may be pulled back on to the item it has already
// crept past, as a share of an item — counting the ground the curve covers
// going forward first. Past this it runs on to the next item instead, since
// what would otherwise happen is a visible rubber band.
const SETTLE_BACK = 0.25;
// How fast the chase's speed ceiling lifts, per frame at 60fps, after a
// landing hands back to it (see capChase).
const CHASE_CAP_GROWTH = 1.12;
// Floor on a landing's duration (s) when it has to stop where it is rather
// than run on to the next item. Shorter than T_MIN: a firm stop on the
// nearest item is better than skipping past it.
const T_HARD = 0.24;

/**
 * Landing curve: quintic in normalised time s (0..1) from x0 — moving at v0
 * (px/s) and accelerating at a0 (px/s²) — to x1, arriving with zero velocity
 * and zero acceleration.
 */
interface Landing {
  x0: number;
  x1: number;
  T: number; // s
  t0: number; // ms
  // x(s) = x0 + c1 s + c2 s² + c3 s³ + c4 s⁴ + c5 s⁵
  c: [number, number, number, number, number];
}

function makeLanding(x0: number, x1: number, v0: number, a0: number, T: number, t0: number): Landing {
  const c1 = v0 * T;
  const c2 = (a0 * T * T) / 2;
  const A = x1 - x0 - c1 - c2;
  const B = -(c1 + 2 * c2);
  const C = -2 * c2;
  return {
    x0,
    x1,
    T,
    t0,
    c: [c1, c2, 10 * A - 4 * B + C / 2, -15 * A + 7 * B - C, 6 * A - 3 * B + C / 2],
  };
}

function landingAt(L: Landing, s: number) {
  const [c1, c2, c3, c4, c5] = L.c;
  return L.x0 + s * (c1 + s * (c2 + s * (c3 + s * (c4 + s * c5))));
}

/** True when the curve never moves backwards (no wobble at the end). */
function isMonotone(L: Landing) {
  const [c1, c2, c3, c4, c5] = L.c;
  const dir = Math.sign(L.x1 - L.x0);
  if (dir === 0) return true;
  for (let i = 0; i <= 32; i++) {
    const s = i / 32;
    const slope = c1 + s * (2 * c2 + s * (3 * c3 + s * (4 * c4 + s * 5 * c5)));
    if (slope * dir < -1e-6 * Math.abs(L.x1 - L.x0)) return false;
  }
  return true;
}

/**
 * The longest curve from x0 (at v0, a0) to x1 within [tMin, tMax] that never
 * runs backwards — the softest ease-out that doesn't sail past the item and
 * come back. Null when even the shortest one would.
 */
function cleanest(
  x0: number, x1: number, v0: number, a0: number,
  tMin: number, tMax: number, t0: number
): Landing | null {
  for (const a of [a0, 0]) {
    for (let T = tMax; T >= tMin; T *= 0.92) {
      const L = makeLanding(x0, x1, v0, a, T, t0);
      if (isMonotone(L)) return L;
    }
  }
  return null;
}

/** How far a curve runs on past its destination, measured along `dir`. */
function overrun(L: Landing, dir: number) {
  let m = 0;
  for (let i = 0; i <= 32; i++) m = Math.max(m, (landingAt(L, i / 32) - L.x1) * dir);
  return m;
}

/**
 * The curve used when speed alone won't carry the scroll to `x1` — a nudge
 * on to the next item, a settle back on to this one, or a stop from rest.
 * Timed by distance; nothing to carry over, since it isn't already slowing
 * to a stop.
 */
function settleCurve(x0: number, x1: number, v0: number, sp: number, t0: number) {
  const T = Math.min(T_MAX, Math.max(T_MIN, 0.5 + (Math.abs(x1 - x0) / sp) * 0.4));
  return makeLanding(x0, x1, v0, 0, T, t0);
}

export class ScrollEngine {
  target = 0;
  current = 0;
  velocity = 0; // px per frame, for the bend / RGB effects
  spacing = 1;
  count = 1;

  private inputHeld = false;
  private lastInputTime = -Infinity;
  private landing: Landing | null = null;
  private needsLanding = false;
  private lastUpdate = 0;
  private lastDt = 1 / 60;
  private prevSpeed = 0; // px/s one frame earlier, for the hand-over deceleration
  private chaseCap = Infinity; // px/s ceiling on the chase, after a hand-off

  // Current wheel gesture.
  private lastAbs = 0;
  private peak = 0;
  private decayRun = 0;
  private ratios: number[] = [];
  private dir = 0;
  private absorbing = false; // momentum tail being swallowed after planning
  private gestureStart = 0; // where the scroll was headed when this gesture began
  private gestureFirst = 0; // size of the gesture's first wheel event (0 for drags)
  // Wheel input that arrived during a landing without meaning to move on
  // (see input()), and the size of its first event.
  private held = 0;
  private heldFirst = 0;
  private heldFresh = false; // the held input began a new gesture

  setLayout(spacing: number, count: number) {
    if (spacing > 0 && this.spacing > 0 && spacing !== this.spacing) {
      // Keep the same item centered when the axis length changes on resize
      // or orientation flip. A landing in flight is simply re-planned from
      // the rescaled position.
      const factor = spacing / this.spacing;
      this.target *= factor;
      this.current *= factor;
      if (this.landing) {
        this.target = this.landing.x1 * factor;
        this.landing = null;
        this.needsLanding = true;
      }
    }
    this.spacing = spacing;
    this.count = count;
  }

  reset() {
    this.target = 0;
    this.current = 0;
    this.velocity = 0;
    this.prevSpeed = 0;
    this.landing = null;
    this.needsLanding = false;
    this.absorbing = false;
    this.chaseCap = Infinity;
  }

  /**
   * A landing has just handed back to the chase. The chase closes CHASE of
   * the remaining gap every frame, which is far faster than the landing was
   * moving, so the motion lurches — and the next plan reads that lurch as
   * real speed, decides it's going too fast to stop on the item it chose,
   * and runs on to the next one. Holding the chase to the speed the motion
   * actually had, and letting the ceiling lift from there, keeps the
   * hand-over honest.
   */
  private capChase() {
    const v = this.lastDt > 0 ? Math.abs(this.velocity / this.lastDt) : 0;
    this.chaseCap = Math.max(v, this.spacing * 0.25);
  }

  /** Wheel / trackpad scroll by `delta` px. */
  input(delta: number) {
    const now = performance.now();
    const a = Math.abs(delta);
    const dir = Math.sign(delta);

    // Swallowing a trackpad momentum tail that the planned landing already
    // accounts for. A delta that grows, turns round, or arrives after a pause
    // is a fresh push.
    if (this.absorbing && now - this.lastInputTime > GESTURE_GAP_MS) this.absorbing = false;
    // A new push landing on a momentum tail still running: it adds to where
    // that momentum was taking the scroll.
    let overMomentum = false;
    if (this.absorbing) {
      if (dir === this.dir && a <= this.lastAbs * 1.15 + 0.5) {
        this.lastAbs = a;
        this.lastInputTime = now;
        return;
      }
      this.absorbing = false;
      overMomentum = true;
    }
    const fresh = now - this.lastInputTime > GESTURE_GAP_MS || dir !== this.dir;

    // A new input during a landing (a fresh tap, or a notch). Until it means
    // to move on — the same bar as in plan(): a wheel notch, or INTENT_TRAVEL
    // of an item — the landing carries on untouched. Breaking it for every stray event handed the motion to the
    // chase, which closes on the item far faster than the landing was moving;
    // the next plan read that speed as too fast to stop and carried on a whole
    // item. A slowly-clicked wheel or a trackpad's leftover events walked the
    // gallery on an item at a time that way.
    // A trackpad gesture still going while a landing runs. Pushed on top of
    // a momentum tail, it adds to where that momentum was headed. Carried on
    // after a mere hesitation (a pause long enough to start a landing), it
    // picks up from where the motion is now, 1:1 under the finger: jumping
    // the target to the landing's item instead raced the chase ahead and
    // over-carried, and holding the landing left the scroll stuck.
    if (this.landing && !fresh && a < NOTCH_PX) {
      this.target = overMomentum ? this.landing.x1 : this.current;
      this.landing = null;
      this.capChase();
    }
    if (this.landing) {
      // A new gesture during a landing starts from where that landing is
      // headed — recorded now rather than at the hand-back below, because
      // the landing may well finish first. Left stale, the next plan
      // measured this gesture's travel from the *previous* gesture's start,
      // so a reversal just after a landing read as a short move forward and
      // snapped back the way it had come.
      if (fresh) {
        this.held = 0;
        this.gestureStart = this.landing.x1;
        this.gestureFirst = a;
      }
      // Judged from the first event since this landing began, so each notch
      // of a spinning wheel counts — not just the first of the gesture.
      if (this.held === 0) {
        this.heldFirst = a;
        this.heldFresh = fresh;
      }
      this.held += delta;
      this.dir = dir;
      this.lastAbs = a;
      this.lastInputTime = now;
      if (Math.abs(this.held) < INTENT_TRAVEL * this.spacing && this.heldFirst < NOTCH_PX) return;
      // It means it: hand back to the chase, heading for where the landing
      // was going plus this input. A new gesture starts from that item; one
      // that's still going (a wheel spun steadily) keeps its own start, so
      // its notches add up as one scroll rather than an item apiece.
      const from = this.landing.x1;
      this.landing = null;
      this.capChase();
      if (this.heldFresh) {
        this.gestureStart = from;
        this.gestureFirst = this.heldFirst;
      }
      this.target = from + this.held;
      this.held = 0;
      this.peak = a;
      this.decayRun = 0;
      this.ratios = [];
      this.needsLanding = true;
      return;
    }

    if (fresh) {
      this.chaseCap = Infinity;
      this.gestureStart = this.target;
      this.gestureFirst = a;
      this.peak = 0;
      this.decayRun = 0;
      this.ratios = [];
    } else if (this.lastAbs > 0 && a < this.lastAbs) {
      this.decayRun++;
      this.ratios.push(a / this.lastAbs);
      if (this.ratios.length > 6) this.ratios.shift();
    } else {
      this.decayRun = 0;
      this.ratios = [];
    }
    this.peak = Math.max(this.peak, a);
    this.dir = dir;
    this.lastAbs = a;
    this.lastInputTime = now;
    this.target += delta;
    this.needsLanding = true;

    // The momentum tail has started: estimate the distance it still carries
    // (a geometric series at the measured decay ratio), land there now, and
    // absorb the rest of it.
    if (
      this.decayRun >= DECAY_RUN &&
      this.peak >= MIN_PEAK &&
      a < this.peak * DECAY_FROM_PEAK
    ) {
      const r = Math.min(
        0.985,
        Math.max(0.8, this.ratios.reduce((s, x) => s + x, 0) / this.ratios.length)
      );
      const remaining = (a * r) / (1 - r);
      this.plan(this.target + dir * remaining, true);
      this.absorbing = true;
    }
  }

  /** @deprecated Wheel input now goes through `input()`. */
  notifyInput() {
    this.lastInputTime = performance.now();
    this.needsLanding = true;
  }

  /** Call on drag start (true) and drag end (false). */
  setInputHeld(held: boolean) {
    this.inputHeld = held;
    this.lastInputTime = performance.now();
    if (held) {
      this.gestureStart = this.landing ? this.landing.x1 : this.target;
      this.gestureFirst = 0;
      if (this.landing) this.target = this.current;
      this.landing = null;
      this.absorbing = false;
      this.chaseCap = Infinity;
    } else {
      this.needsLanding = true;
    }
  }

  /** Drag released: carry on by `fling` px (its momentum) and land. */
  release(fling: number) {
    this.inputHeld = false;
    this.target += fling;
    this.plan(this.target, true);
  }

  /**
   * Plan the landing: choose the item to rest on and the curve to it.
   * `snap` rounds to an item, by momentum; without it `projected` is already
   * an exact item position (chevrons, menu clicks).
   *
   * Always starts from the last drawn frame — its position, time, speed and
   * deceleration — so the first frame of the landing continues the motion
   * exactly. (Planning from an input event's own time, which falls between
   * frames, made that first frame cover only part of a frame's travel.)
   */
  private plan(projected: number, snap: boolean) {
    this.needsLanding = false;
    this.held = 0;
    this.chaseCap = Infinity;
    const sp = this.spacing;
    if (sp <= 0) return;
    const t0 = this.lastUpdate || performance.now();
    const x0 = this.current;
    const v0 = this.lastDt > 0 ? this.velocity / this.lastDt : 0;
    const dir = Math.abs(v0) > 1 ? Math.sign(v0) : 0;
    // Only carry over deceleration (slowing in the direction of travel);
    // a speeding-up chase is cut to a steady start rather than extrapolated.
    let a0 = this.lastDt > 0 ? (v0 - this.prevSpeed) / this.lastDt : 0;
    if (dir === 0 || Math.sign(a0) === dir) a0 = 0;
    a0 = Math.max(-4 * Math.abs(v0), Math.min(4 * Math.abs(v0), a0));

    let x1: number;
    if (snap) {
      let idx = Math.round(projected / sp);
      const from = Math.round(this.gestureStart / sp);
      const moved = projected - this.gestureStart;
      const meant =
        Math.abs(moved) >= INTENT_TRAVEL * sp || this.gestureFirst >= NOTCH_PX;
      // Deliberate but short: on to the neighbouring item rather than back.
      if (idx === from && meant && Math.abs(moved) > 0.5) idx = from + Math.sign(moved);
      // The nearest item can be one the chase has already slipped past,
      // because it keeps closing on the target through the quiet moment that
      // ends the gesture. Settling back on to it is right as long as it's a
      // short, soft pull; so measure the curve — how far it sails on before
      // it comes back — and only when that's more than SETTLE_BACK of an item
      // give up and run on to the next one. Refusing to land behind at all,
      // as this used to, pushed every scroll whose chase had crept past its
      // own item a whole item further; measuring instead is what stopped
      // ordinary scrolls arriving one teaser late.
      if (idx !== from && dir !== 0 && (idx * sp - x0) * dir < 0) {
        const bounce = overrun(settleCurve(x0, idx * sp, v0, sp, t0), dir);
        if (bounce > SETTLE_BACK * sp) {
          idx = dir > 0 ? Math.floor(x0 / sp) + 1 : Math.ceil(x0 / sp) - 1;
        }
      }
      x1 = idx * sp;
    } else {
      x1 = projected;
    }

    if (Math.abs(x1 - x0) < 0.5 && Math.abs(v0) < 5) {
      this.current = this.target = x1;
      this.landing = null;
      return;
    }

    const v = Math.abs(v0);
    // Rounding may already lean up to half an item past where the input was
    // headed; momentum may not invent any travel beyond that.
    const reach = 0.5 * sp;
    let best: Landing | null = null;
    // Momentum-chosen landings may carry on up to three items further when
    // the scroll is too fast to stop cleanly at the first.
    for (let step = 0; step < (snap ? 4 : 1) && !best; step++) {
      const target = x1 + step * dir * sp;
      const D = Math.abs(target - x0);
      const toward = dir !== 0 && Math.sign(target - x0) === dir;
      // Running on is only ever an option while the item after this one is
      // still within reach of where the input pointed. Without that limit,
      // any scroll moving quickly with a short way left to its item counted
      // as too fast to stop and took a whole extra item — a one-item scroll
      // routinely landed two on, which is what made this feel twitchy.
      const mayCarry =
        snap &&
        step < 3 &&
        (x1 + (step + 1) * dir * sp - projected) * (dir || 1) <= reach;
      // Too fast to stop here, so go further — but only when it's really
      // moving. Slow enough, a short settle stops it gently anyway.
      const longest = (GLIDE_SLOPE * D) / Math.max(v, 1e-6);
      if (toward && longest < T_MIN && v > CARRY_MIN_SPEED * sp && mayCarry) continue;
      // When running on isn't allowed, the curve may go below T_MIN: a firm
      // stop on the nearest item beats skipping to the next one.
      const floor = mayCarry ? T_MIN : T_HARD;
      if (toward && longest >= floor && longest <= T_MAX) {
        // A glide: the speed alone carries it there. Take the longest clean
        // curve, keeping the deceleration it already had.
        best = cleanest(x0, target, v0, a0, floor, longest, t0);
      } else {
        // Too slow to glide there (a nudge carried to the next item), at
        // rest, moving away, or nearly there and barely moving: a settle that
        // eases in, timed by distance.
        const L = settleCurve(x0, target, v0, sp, t0);
        const T = L.T;
        // That timing assumes there's no real speed to shed. When there is
        // — a fast scroll that isn't allowed to run on — the curve would
        // sail past the item and come back, so shorten it until it doesn't.
        // A settle that runs *against* the motion (a nudge falling back to
        // where it started) reverses by design and is taken as it is.
        best =
          (toward && !isMonotone(L)
            ? cleanest(x0, target, v0, 0, 0.1, T, t0)
            : null) ?? L;
      }
    }
    if (!best) best = cleanest(x0, x1, v0, 0, 0.1, T_MAX, t0);
    if (!best) best = makeLanding(x0, x1, v0, 0, T_MIN, t0);

    this.landing = best;
    this.target = best.x1;
  }

  update() {
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min(0.05, (now - this.lastUpdate) / 1000) : 1 / 60;
    // Input has gone quiet: plan the landing *before* moving this frame, so it
    // starts from the last drawn position at the last drawn speed.
    if (
      !this.landing &&
      this.needsLanding &&
      !this.inputHeld &&
      now - this.lastInputTime > LANDING_IDLE_MS
    ) {
      this.plan(this.target, true);
    }
    const speedBefore = this.lastDt > 0 ? this.velocity / this.lastDt : 0;
    this.lastUpdate = now;
    const prev = this.current;

    if (this.landing) {
      const L = this.landing;
      const s = (now - L.t0) / 1000 / L.T;
      if (s >= 1) {
        this.current = L.x1;
        this.landing = null;
      } else {
        this.current = landingAt(L, s);
      }
    } else {
      // Frame-rate independent form of "close CHASE of the gap per frame",
      // held under the ceiling a hand-off left behind (see capChase).
      const k = 1 - Math.pow(1 - CHASE, dt * 60);
      let step = (this.target - this.current) * k;
      const cap = this.chaseCap * dt;
      if (Math.abs(step) > cap) step = Math.sign(step) * cap;
      this.chaseCap *= Math.pow(CHASE_CAP_GROWTH, dt * 60);
      this.current += step;
    }

    this.prevSpeed = speedBefore;
    this.lastDt = dt;
    this.velocity = this.current - prev;
  }

  /**
   * True once the strip has genuinely stopped on an item centre — not merely
   * slowed down. Gates teaser video, which must never share a frame with the
   * scroll animation.
   */
  get settled() {
    if (this.spacing <= 0) return false;
    const p = this.current / this.spacing;
    return (
      !this.landing &&
      Math.abs(p - Math.round(p)) < 0.004 &&
      Math.abs(this.velocity) < 0.08
    );
  }

  get activeIndex() {
    const raw = Math.round(this.current / this.spacing) % this.count;
    return raw < 0 ? raw + this.count : raw;
  }

  /**
   * Advance by whole items, for the menu's prev/next chevrons. Steps from
   * where the scroll is already headed, so a click mid-glide lands on an
   * exact item centre and repeated clicks accumulate one item each.
   */
  stepItems(delta: number) {
    if (this.spacing <= 0) return;
    const headed = this.landing ? this.landing.x1 : this.target;
    const snapped = Math.round(headed / this.spacing) * this.spacing;
    this.absorbing = false;
    this.plan(snapped + delta * this.spacing, false);
  }

  scrollToIndex(index: number) {
    const total = this.count * this.spacing;
    const base = index * this.spacing;
    // Travel to the nearest wrapped copy of the requested item.
    const wraps = Math.round((this.current - base) / total);
    this.absorbing = false;
    this.plan(base + wraps * total, false);
  }
}
