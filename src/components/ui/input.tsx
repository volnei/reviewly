"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    size = "default",
    unstyled = false,
    nativeInput = false,
    style,
    ...props
  },
  ref,
): React.ReactElement {
  const inputClassName = cn(
    "h-8 w-full min-w-0 rounded-[inherit] px-3 text-[12px] text-foreground leading-8 outline-none [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-muted-foreground/72 autofill:[-webkit-text-fill-color:var(--foreground)]",
    size === "sm" &&
      "h-7 px-2.5 text-[11px] leading-7",
    size === "lg" && "h-9 text-[13px] leading-9",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-md border border-input bg-background text-[12px] ring-ring/24 transition-colors has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-60 has-focus-visible:ring-2 dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          ref={ref}
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          ref={ref}
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
});

;
