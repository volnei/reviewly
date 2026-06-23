/**
 * Reviewly brand mark — a brilliant-cut gem, identical to the app/dock icon.
 * The facets are real multi-tone fills (table brightest, pavilion darkest, lit
 * top-left) so the cut reads from color contrast, not knocked-out seams — which
 * kept the small sizes from looking split in two. A thin outline keeps the gem
 * crisp on light backgrounds. Fixed brand colors (does not follow currentColor).
 */
export function ReviewlyGlyph({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
    >
      {/* facets */}
      <path d="M7.3 5.3 L16.7 5.3 L12 12 Z" fill="#d4daff" />
      <path d="M7.3 5.3 L2 12 L12 12 Z" fill="#b0b8ff" />
      <path d="M16.7 5.3 L22 12 L12 12 Z" fill="#8b92fb" />
      <path d="M2 12 L12 21.4 L12 12 Z" fill="#6d6cf4" />
      <path d="M22 12 L12 12 L12 21.4 Z" fill="#5049df" />
      {/* top rim light + specular sparkle */}
      <path
        d="M7.3 5.3 L16.7 5.3"
        stroke="#ffffff"
        strokeOpacity="0.5"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <path d="M9 6.2 L11 6.2 L10 8 Z" fill="#ffffff" fillOpacity="0.5" />
      {/* outline for definition on light backgrounds */}
      <path
        d="M7.3 5.3 L16.7 5.3 L22 12 L12 21.4 L2 12 Z"
        fill="none"
        stroke="#3b34c4"
        strokeOpacity="0.45"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
