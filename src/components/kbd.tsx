import { cn } from "@/lib/utils";
import { ArrowBigUp, Command, CornerDownLeft } from "lucide-react";

const ICON = "size-3 shrink-0";

/** Inline keyboard-key glyphs for hint text — proper icons, not raw Unicode
 * (↵ / ⇧ / ⌘). Wrap consumers in an `inline-flex items-center` row. */
export const KbdEnter = ({ className }: { className?: string }) => (
  <CornerDownLeft className={cn(ICON, className)} aria-hidden />
);
export const KbdShift = ({ className }: { className?: string }) => (
  <ArrowBigUp className={cn(ICON, className)} aria-hidden />
);
export const KbdCmd = ({ className }: { className?: string }) => (
  <Command className={cn(ICON, className)} aria-hidden />
);
