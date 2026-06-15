"use client";

/** AW monogram. Inherits color via fill="currentColor" — set text color to tint. */
export default function LogoMark({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 96.915"
      className={className}
      style={style}
      fill="currentColor"
      aria-label="Andy Weitzel"
    >
      <polygon points="130.73 96.915 100.142 96.915 69.27 0 99.858 0 130.73 96.915" />
      <polygon points="169.413 0 184.849 48.458 200 0 169.413 0" />
      <polygon points="30.587 96.915 15.151 48.458 0 96.915 30.587 96.915" />
      <polygon points="149.929 0 119.341 0 150.214 96.915 169.698 96.915 175.198 79.325 149.929 0" />
      <polygon points="30.302 0 24.802 17.59 50.071 96.915 80.659 96.915 49.786 0 30.302 0" />
    </svg>
  );
}
