import { useNavigate } from "@tanstack/react-router";
import { CloudOff, Download, LoaderCircle } from "lucide-react";
import type { MouseEvent } from "react";

import { useOnline } from "@/app/online";
import { useTeamsPlan } from "@/app/teams-billing";
import { useTitleSlotValue } from "@/app/title-slot";
import { downloadAvailableUpdate, useUpdaterState } from "@/app/updater";
import { WorkspacePicker } from "@/app/workspace-picker";
import { isNative } from "@/effect/Tauri";
import { useAiActivity } from "@/features/pr/ai";
import { cn } from "@/lib/utils";

/**
 * One bar across the whole window, in the screen's own colour, centred on the
 * traffic lights (tauri.conf places their visual centre on this 46px row, so
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
  const teamsPlan = useTeamsPlan();
  const updater = useUpdaterState();
  const currentActivity =
    [...activities].reverse().find((activity) => activity.returnTo) ?? activities.at(-1);
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  const onMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || !isNative()) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      e.detail === 2 ? getCurrentWindow().toggleMaximize() : getCurrentWindow().startDragging(),
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
      {teamsPlan ? (
        <span
          className="titlebar-plan mr-1 text-[11px] text-ink-3"
          title={
            teamsPlan === "teams"
              ? "Teams plan — shared review queues are active"
              : "Hobby plan — local Reviewly is free"
          }
          aria-label={`Reviewly ${teamsPlan === "teams" ? "Teams" : "Hobby"} plan`}
        >
          {teamsPlan === "teams" ? "Teams" : "Hobby"}
        </span>
      ) : null}
      <WorkspacePicker />
      <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 pr-3">{node}</div>
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
              <span className="font-mono text-[10px] text-ink-3">+{activities.length - 1}</span>
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
      {updater.status !== "idle" ? (
        <button
          type="button"
          onClick={() => void downloadAvailableUpdate()}
          disabled={updater.status === "installing"}
          className="mr-3 flex h-7 shrink-0 items-center gap-2 rounded-md border border-workspace/30 bg-workspace/10 px-2.5 text-[11.5px] font-medium text-ink transition-colors hover:border-workspace/55 hover:bg-workspace/16 disabled:cursor-wait disabled:opacity-75"
          title={
            updater.status === "installing"
              ? `Downloading Reviewly ${updater.version}`
              : `Download Reviewly ${updater.version}`
          }
          aria-label={
            updater.status === "installing"
              ? `Downloading Reviewly ${updater.version}`
              : `Download Reviewly ${updater.version}`
          }
        >
          {updater.status === "installing" ? (
            <LoaderCircle className="size-3.5 animate-spin text-workspace" aria-hidden="true" />
          ) : (
            <Download className="size-3.5 text-workspace" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span>{updater.status === "installing" ? "Downloading…" : "Download update"}</span>
          <span className="font-mono text-[9.5px] text-ink-3">v{updater.version}</span>
        </button>
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
