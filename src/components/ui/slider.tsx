"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

export function Slider({
  value,
  min,
  max,
  step = 1,
  disabled,
  ariaLabel,
  ariaValueText,
  onValueChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  ariaValueText?: (value: number) => string;
  onValueChange: (value: number) => void;
  className?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={onValueChange}
      className={cn("w-full touch-none select-none", className)}
    >
      <SliderPrimitive.Control className="flex h-5 w-full items-center">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-raise">
          <SliderPrimitive.Indicator className="rounded-full bg-ink-2" />
          <SliderPrimitive.Thumb
            getAriaLabel={() => ariaLabel}
            getAriaValueText={(_, current) => ariaValueText?.(current) ?? String(current)}
            className="size-3.5 rounded-full border border-edge bg-ink shadow-sm outline-none ring-ring/30 transition-transform hover:scale-110 focus-visible:ring-3 data-[dragging]:scale-110"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
