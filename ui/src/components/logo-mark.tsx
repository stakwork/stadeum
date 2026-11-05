/** The stadeum mark: contour rings around a peak. Rings take the text colour. */
export function LogoMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
    >
      <g fill="none" stroke="currentColor" strokeWidth="2.6">
        <circle cx="35" cy="30.5" r="12.5" />
        <circle cx="33" cy="32" r="19" />
        <circle cx="31" cy="33.5" r="25.5" />
      </g>
      <circle cx="37" cy="29" r="5" fill="#FF5A1F" />
    </svg>
  );
}
