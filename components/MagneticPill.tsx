"use client";

import { useEffect, useRef } from "react";

/**
 * A pill that leans toward the cursor as it comes near, and settles back when
 * it leaves. Used for the landing gate's two portfolio buttons — the question
 * is typed at you, so the answers reaching back is the point.
 *
 * Desktop only, and gated on `(pointer: fine) and (hover: hover)` rather than
 * on touch points: an iPad with a trackpad reports touch points and still has
 * hover intent (see CLAUDE.md), while a phone has neither and would only get a
 * pill that jumps under the finger already pressing it.
 *
 * The pull is driven by a rAF lerp, not a CSS transition. The target moves
 * with every pointer event, and a transition on top of that chases a value
 * that has already changed — which reads as lag, not weight.
 */

/** Field reach past the pill's own edge, in multiples of its height. */
const FIELD = 0.9;
/** Fraction of the cursor's offset the pill travels at full strength. */
const PULL = 0.3;
/** Extra drift on the label, as a fraction of the pill's own, for parallax. */
const LABEL_LEAD = 0.35;
/** Lerp toward the target each frame. */
const EASE = 0.2;
/** Distance below which the motion is called done and the loop stops. */
const REST = 0.05;

export default function MagneticPill({
  active,
  onClick,
  className,
  style,
  children,
}: {
  /** False while the row is still faded out — nothing to reach for yet. */
  active: boolean;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const at = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    const fine = window.matchMedia?.("(pointer: fine) and (hover: hover)");
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!fine?.matches || still?.matches) return;

    const draw = () => {
      const now = at.current;
      const to = target.current;
      now.x += (to.x - now.x) * EASE;
      now.y += (to.y - now.y) * EASE;
      const done =
        Math.abs(to.x - now.x) < REST && Math.abs(to.y - now.y) < REST;
      if (done) {
        now.x = to.x;
        now.y = to.y;
      }
      el.style.transform = `translate3d(${now.x.toFixed(2)}px, ${now.y.toFixed(2)}px, 0)`;
      if (label.current)
        label.current.style.transform = `translate3d(${(now.x * LABEL_LEAD).toFixed(2)}px, ${(now.y * LABEL_LEAD).toFixed(2)}px, 0)`;
      frame.current = done ? 0 : requestAnimationFrame(draw);
    };

    const kick = () => {
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    };

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      // The rect already carries the pull we applied, so take it back out
      // before measuring — otherwise the pill chases its own displacement and
      // walks away from the cursor instead of toward it.
      const cx = r.left + r.width / 2 - at.current.x;
      const cy = r.top + r.height / 2 - at.current.y;
      const reach = r.height * FIELD;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      // An ellipse around the pill rather than a circle: the field should sit
      // the same distance off a long edge as off a short one.
      const n = Math.hypot(dx / (r.width / 2 + reach), dy / (r.height / 2 + reach));
      // Zero at the edge of the field and at the centre alike — the pull peaks
      // partway in, where there is both strength and somewhere to go.
      const strength = n >= 1 ? 0 : 1 - n;
      target.current.x = dx * PULL * strength;
      target.current.y = dy * PULL * strength;
      kick();
    };

    const away = () => {
      target.current.x = 0;
      target.current.y = 0;
      kick();
    };

    if (active) {
      window.addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", away);
    } else {
      away();
    }
    // The row may have faded in or out with the pointer held still, so settle
    // whatever the last target was rather than waiting for the next move.
    if (at.current.x !== target.current.x || at.current.y !== target.current.y)
      kick();

    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", away);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [active]);

  return (
    <button ref={btn} type="button" onClick={onClick} className={className} style={style}>
      <span ref={label} className="inline-block">
        {children}
      </span>
    </button>
  );
}
