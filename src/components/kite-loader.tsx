import type { Ref } from "react";

/**
 * The brand kite (pipa). Its position + bank are driven externally (a spring
 * physics loop tugs it by the line toward the cursor, with a light idle sway);
 * here we only render the kite and animate the *local* life — the sail billows
 * (skews + breathes like fabric catching air) and a two-segment tail whips. The
 * `anchorRef` marks the bridle so the flying-line effect can read the kite's
 * live position. Fixed brand colours; local motion stills under
 * prefers-reduced-motion (globals.css). Decorative.
 */
export function KiteLoader({
  className,
  anchorRef,
}: {
  className?: string;
  /** Invisible bridle point, measured by the flying-line / physics each frame. */
  anchorRef?: Ref<SVGCircleElement>;
}) {
  return (
    <svg
      viewBox="-8 -16 64 102"
      className={className}
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* bridle — where the flying line ties on (invisible, just measured) */}
      <circle ref={anchorRef} cx="24" cy="20" r="0.5" fill="none" />

      {/* tail (rabiola): swings from the kite's bottom tip; the lower segment
          lags into a whip */}
      <g className="kite-tail-anim">
        <path
          d="M24 36 Q 28 42 24 47"
          stroke="#5A3B1E"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path d="M24.1 40 L26.5 42 L24.1 44 Z M28.9 40 L26.5 42 L28.9 44 Z" fill="#FBBC05" />
        <g className="kite-tail-2">
          <path
            d="M24 47 Q 20 53 24 58 Q 28 64 24 69"
            stroke="#5A3B1E"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.8"
          />
          <path d="M19.3 51 L21.7 53 L19.3 55 Z M24.1 51 L21.7 53 L24.1 55 Z" fill="#4285F4" />
          <path d="M23.9 62 L26.3 64 L23.9 66 Z M28.7 62 L26.3 64 L28.7 66 Z" fill="#34A853" />
        </g>
      </g>

      {/* sail: four panels split by crossed spars (the brand mark). The billow
          layer skews + breathes it as the wind hits. */}
      <g className="kite-billow">
        <path d="M24 5 L24 20 L11 20 Z" fill="#FBBC05" />
        <path d="M24 5 L24 20 L37 20 Z" fill="#EA4335" />
        <path d="M24 36 L24 20 L37 20 Z" fill="#4285F4" />
        <path d="M24 36 L24 20 L11 20 Z" fill="#34A853" />
        <path
          d="M24 3 L24 38 M9 20 L39 20"
          stroke="#5A3B1E"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
