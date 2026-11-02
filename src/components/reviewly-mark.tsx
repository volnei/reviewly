import type { SVGProps } from "react";

/**
 * Reviewly's geometric lowercase r.
 *
 * The 26 → 42 → 68 construction follows a golden-ratio sequence. The
 * concentric review arc resolves into a decisive 36° terminal cut.
 */
export function ReviewlyMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 180 208"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        fill="currentColor"
        d="M28.5 194V82A68 68 0 0 1 151.513 42.031L117.534 66.717A26 26 0 0 0 70.5 82V194H28.5Z"
      />
    </svg>
  );
}
