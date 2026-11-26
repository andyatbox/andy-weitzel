"use client";

/**
 * The rail's pill button, in the menu's brand block and in the filter panel
 * that replaces it. Shared rather than copied because the two sit in the same
 * rectangle a third of a second apart — any drift in their shape or weight
 * reads as the panel changing size as it slides.
 */
export default function Pill({
  active,
  onClick,
  href,
  onHoverChange,
  ariaLabel,
  ariaPressed,
  size,
  pad,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  href?: string;
  onHoverChange?: (active: boolean) => void;
  ariaLabel?: string;
  /** Set on a pill that toggles rather than navigates, so it reads as such. */
  ariaPressed?: boolean;
  /** Type size in px; padding is derived from it so the pill scales whole. */
  size: number;
  /** Padding override as [y, x] in px, for a pill held to a fixed shape. */
  pad?: [number, number];
  children: React.ReactNode;
}) {
  const cls = `inline-flex items-center rounded-full border font-medium transition-colors ${
    active
      ? "border-white bg-white text-black"
      : "border-white/30 text-white hover:border-white/70"
  }`;
  // Driven from `size` rather than breakpoint utilities: the list type beside
  // these already rides the wide-display ramp (railMetrics.fontBump), and the
  // Work pair pinned at text-base shrank against it on a very wide rail. A
  // caller that wants the old fixed shape passes `pad` instead of inheriting
  // the derived one.
  const [padY, padX] = pad ?? [
    Math.round(size * 0.42),
    Math.round(size * 0.95),
  ];
  const style: React.CSSProperties = {
    fontSize: size,
    padding: `${padY}px ${padX}px`,
  };
  const hover = onHoverChange
    ? {
        onMouseEnter: () => onHoverChange(true),
        onMouseLeave: () => onHoverChange(false),
      }
    : undefined;
  if (href) {
    return (
      <a
        href={href}
        className={cls}
        style={style}
        aria-label={ariaLabel}
        {...hover}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      style={style}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      {...hover}
    >
      {children}
    </button>
  );
}
