"use client";

import { useEffect, useState } from "react";

const WORDS = ["Andy Weitzel", "Creative Director"];
const HOLD_MS = 3000;
// Taller than the type so descenders (the y in Andy) aren't clipped by the
// overflow that makes the roll work. Also the step the wheel travels.
const LINE = "1.28em";

/**
 * The wordmark, rolling vertically between the name and the role like a
 * gauge wheel. The first word is repeated at the end as a clone, so the loop
 * back to the top happens off-screen with the transition switched off and
 * never reads as a rewind.
 */
export default function NameWheel({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const [i, setI] = useState(0);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), HOLD_MS);
    return () => clearInterval(id);
  }, []);

  // Landed on the clone: snap back to the real first word, mid-hold.
  useEffect(() => {
    if (i !== WORDS.length) return;
    const t = setTimeout(() => {
      setAnimate(false);
      setI(0);
    }, 700);
    return () => clearTimeout(t);
  }, [i]);

  // Re-arm the transition a frame after the snap.
  useEffect(() => {
    if (animate) return;
    const r = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(r);
  }, [animate]);

  const list = [...WORDS, WORDS[0]];

  return (
    <span
      className={`block overflow-hidden ${className ?? ""}`}
      style={{ ...style, height: LINE }}
    >
      {/* The full pair for assistive tech; the roll itself is decoration. */}
      <span className="sr-only">{WORDS.join(", ")}</span>
      <span
        aria-hidden
        className="block"
        style={{
          transform: `translateY(calc(-${LINE} * ${i}))`,
          transition: animate
            ? "transform 0.55s cubic-bezier(0.7, 0, 0.2, 1)"
            : "none",
          willChange: "transform",
        }}
      >
        {list.map((word, k) => (
          <span
            key={k}
            className="block whitespace-nowrap"
            style={{ height: LINE, lineHeight: LINE }}
          >
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}
