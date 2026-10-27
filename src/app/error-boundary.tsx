import { Component, type ErrorInfo, type ReactNode } from "react";
import { failureText, recoveryHint } from "@/lib/reliability";

interface State {
  error: Error | null;
}

/** The last line of defence: a plain message and a way back, never a white window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[reviewly] render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-page p-8 text-ink">
        <div className="max-w-md">
          <h1 className="text-[17px] font-medium">Something broke while drawing this screen.</h1>
          <p className="mt-2 text-ink-2">{failureText(this.state.error)}</p>
          <p className="mt-1 text-[13px] text-ink-3">{recoveryHint(this.state.error)}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="h-7 rounded-md bg-ink px-3 text-[13px] text-page hover:opacity-90"
              onClick={() => this.setState({ error: null })}
            >
              Retry this screen
            </button>
            <button
              type="button"
              className="h-7 rounded-md border border-edge bg-raise px-3 text-[13px] hover:bg-accent"
              onClick={() => window.location.assign("/")}
            >
              Back to the Inbox
            </button>
          </div>
        </div>
      </div>
    );
  }
}
