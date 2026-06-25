/**
 * Reviewly brand mark — a colourful kite (pipa): four panels split by crossed
 * brown spars, tilted, tailless. Matches the app/Dock icon. Fixed brand colours
 * (does not follow currentColor).
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
      <g transform="rotate(18 12 12)">
        {/* panels: yellow top-left, red top-right, blue bottom-right, green bottom-left */}
        <path d="M12 3 L12 11 L4 11 Z" fill="#FBBC05" />
        <path d="M12 3 L12 11 L20 11 Z" fill="#EA4335" />
        <path d="M12 21 L12 11 L20 11 Z" fill="#4285F4" />
        <path d="M12 21 L12 11 L4 11 Z" fill="#34A853" />
        {/* crossed spars (extend past the fabric) */}
        <path
          d="M12 2 L12 22 M3 11 L21 11"
          stroke="#5A3B1E"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
