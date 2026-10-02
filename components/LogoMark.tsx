"use client";

import { useId } from "react";

// Ten slanted stripes, two identical sets of five, 62.5944 apart. The logo is
// the parallelogram window (the clip) over them; sliding the stripes through
// the window is the animation. See `.logo-slide` in globals.css: the group
// moves left by exactly five stripes (312.9721), which brings the second set
// to where the first started — the last frame is identical to the first, so
// the jump back to the start of each loop can't be seen.
const STRIPES = [
  "290.9163 128.4459 250.3777 128.4459 209.4613 0 250 0 290.9163 128.4459",
  "40.5387 128.4459 0 128.4459 -40.9163 0 -.3777 0 40.5387 128.4459",
  "103.1331 128.4459 62.5944 128.4459 21.6781 0 62.2168 0 103.1331 128.4459",
  "228.3219 128.4459 208.0526 128.4459 187.7832 128.4459 167.3251 64.2229 146.8669 0 167.1363 0 187.4056 0 207.8637 64.2229 228.3219 128.4459",
  "165.7275 128.4459 125.1888 128.4459 84.2725 0 124.8112 0 165.7275 128.4459",
  "541.294 128.4459 500.7553 128.4459 459.839 0 500.3777 0 541.294 128.4459",
  "353.5107 128.4459 312.9721 128.4459 272.0558 0 312.5944 0 353.5107 128.4459",
  "478.6996 128.4459 458.4302 128.4459 438.1609 128.4459 417.7028 64.2229 397.2446 0 417.5139 0 437.7832 0 458.2414 64.2229 478.6996 128.4459",
  "416.1051 128.4459 375.5665 128.4459 334.6502 0 375.1888 0 416.1051 128.4459",
  "603.8884 128.4459 563.3497 128.4459 522.4334 0 562.9721 0 603.8884 128.4459",
];

/**
 * AW monogram: stripes sliding through a parallelogram window, resting on the
 * monogram for 3s between slides. Inherits color via fill="currentColor" — set
 * text color to tint.
 */
export default function LogoMark({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  // A clip id per instance: the landing and the menu can both be on screen,
  // and a shared id would tie one logo's clipping to the other's markup (and
  // break it when that one unmounts). useId's characters aren't all valid in
  // a url(#...) reference, so keep just the safe ones.
  const clipId = `aw-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 250 128.4459"
      className={className}
      style={style}
      fill="currentColor"
      role="img"
      aria-label="Andy Weitzel"
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points="0 128.4459 41.9474 0 250 0 208.0526 128.4459 0 128.4459" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g className="logo-slide">
          {STRIPES.map((points) => (
            <polygon key={points} points={points} />
          ))}
        </g>
      </g>
    </svg>
  );
}
