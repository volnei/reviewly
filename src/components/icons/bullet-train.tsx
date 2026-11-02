import { type LucideIcon, type LucideProps } from "lucide-react";
import { forwardRef } from "react";

/** A side-profile high-speed train, drawn on Lucide's 24px stroke grid. */
export const BulletTrain = forwardRef<SVGSVGElement, LucideProps>(
  ({ color = "currentColor", size = 24, strokeWidth = 2, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 7h8.8a11.5 11.5 0 0 1 8.9 4.2L22 13l-1.2 1.7a4.2 4.2 0 0 1-3.4 1.8H3Z" />
      <path d="M6.5 10.5h9.8" />
      <path d="M5 20h14" />
    </svg>
  ),
) as LucideIcon;

BulletTrain.displayName = "BulletTrain";
