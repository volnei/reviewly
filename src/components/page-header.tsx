import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex items-end justify-between gap-4 px-6 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h1 className="truncate font-display text-xl font-medium text-foreground">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-xs tracking-tight text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
