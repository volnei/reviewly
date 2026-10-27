import { useOnline } from "@/app/online";
import { useTitleSlotValue } from "@/app/title-slot";
import { WorkspacePicker } from "@/app/workspace-picker";
import { isNative } from "@/effect/Tauri";
import { useAiActivity } from "@/features/pr/ai";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { CloudOff, LoaderCircle } from "lucide-react";
import type { MouseEvent } from "react";

/**
 * One bar across the whole window, in the screen's own colour, centred on the
 * traffic lights (tauri.conf puts them at 16/18, so the row is 42px and the
 * content starts after them). Press and drag anywhere that isn't a control to
 * move the window; double-click to zoom, like any macOS title bar.
 */
const INTERACTIVE =
  "button, a, input, textarea, select, [role='button'], [role='radio'], [role='group'], kbd";

export function TitleBar() {
  const { node } = useTitleSlotValue();
  const online = useOnline();
  const navigate = useNavigate();
  const activities = useAiActivity();
  const currentActivity =
    [...activities].reverse().find((activity) => activity.returnTo) ??
    activities.at(-1);
  const mac =
    typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  const onMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || !isNative()) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      e.detail === 2
        ? getCurrentWindow().toggleMaximize()
        : getCurrentWindow().startDragging(),
    );
  };

  return (
    <header
      onMouseDown={onMouseDown}
      className={cn(
        "app-titlebar relative z-20 flex h-[46px] shrink-0 select-none items-center",
        mac ? "pl-[84px]" : "pl-3",
      )}
    >
      <span className="titlebar-brand mr-1 text-[12px] font-medium text-ink-2">
        Reviewly
      </span>
      <WorkspacePicker />
      <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 pr-3">
        {node}
      </div>
      {currentActivity ? (
        currentActivity.returnTo ? (
          <button
            type="button"
            onClick={() => void navigate({ to: "/spec-lens" })}
            className="mr-3 flex h-7 max-w-56 shrink-0 items-center gap-2 rounded-md bg-raise px-2.5 text-[11.5px] text-ink-2 hover:text-ink"
            title={`${currentActivity.label}. Open progress.`}
            aria-label={`${currentActivity.label}. Open progress.`}
          >
            <LoaderCircle
              className="size-3.5 shrink-0 animate-spin text-workspace"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="truncate">{currentActivity.label}</span>
            {activities.length > 1 ? (
              <span className="font-mono text-[10px] text-ink-3">
                +{activities.length - 1}
              </span>
            ) : null}
          </button>
        ) : (
          <span
            role="status"
            className="mr-3 flex h-7 max-w-56 shrink-0 items-center gap-2 rounded-md bg-raise px-2.5 text-[11.5px] text-ink-2"
            title={currentActivity.label}
          >
            <LoaderCircle
              className="size-3.5 shrink-0 animate-spin text-workspace"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="truncate">{currentActivity.label}</span>
          </span>
        )
      ) : null}
      {!online ? (
        <span
          role="status"
          className="mr-3 flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-raise px-2 text-[11.5px] text-ink-2"
          title="No network. What you do waits here until it is back."
        >
          <CloudOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          Offline
        </span>
      ) : null}
    </header>
  );
}
