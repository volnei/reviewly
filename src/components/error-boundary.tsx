import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Shared in-app crash fallback. Used both by the top-level React
 * {@link ErrorBoundary} (catches render crashes before the router mounts) and by
 * the TanStack root-route `errorComponent` (catches render crashes inside a
 * route) — so a thrown render never leaves a blank window.
 */
export function CrashFallback({
  error,
  onReload,
}: {
  error?: unknown;
  onReload?: () => void;
}) {
  const reload = onReload ?? (() => window.location.reload());
  const message =
    error instanceof Error ? error.message : error != null ? String(error) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/20">
        <AlertTriangle className="size-5" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Something went wrong</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          The app hit an unexpected error and couldn't render this view.
        </p>
        {message && (
          <pre className="mx-auto mt-3 max-w-md overflow-x-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-left font-mono text-[11px] text-muted-foreground/80">
            {message}
          </pre>
        )}
      </div>
      <Button size="sm" variant="secondary" onClick={reload}>
        <RotateCw className="size-3.5" />
        Reload
      </Button>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

/**
 * Top-level React error boundary. Catches render-phase crashes that escape the
 * router (or happen before a route mounts) and shows {@link CrashFallback}
 * instead of a blank window. "Reload" does a full reload to recover cleanly.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[reviewly] render crash", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error != null) {
      return <CrashFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
