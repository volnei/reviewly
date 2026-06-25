import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { TooltipFor } from "@/components/tooltip-for";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { severityTone } from "@/lib/status";
import type { DependabotAlert } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDependabotRepo } from "@/stores/dependabot";
import { useDependabotGen } from "@/stores/dependabot-gen";
import { useLocalRepos } from "@/stores/local-repos";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

export function DependabotPage() {
  const repo = useDependabotRepo((s) => s.repo);
  const setRepo = useDependabotRepo((s) => s.setRepo);

  const [owner, name] = repo.split("/");
  const valid = Boolean(owner && name);

  const repos = useQuery({
    queryKey: ["repos"],
    queryFn: () => invoke<string[]>("gh_list_repos"),
    staleTime: 5 * 60_000,
  });

  const alerts = useQuery({
    queryKey: ["dependabot-alerts", repo],
    queryFn: () => invoke<DependabotAlert[]>("gh_dependabot_alerts", { owner, repo: name }),
    enabled: valid,
  });

  // 30s tick keeps the "synced Xm ago" label fresh without re-fetching.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Recover the "fixing…" state for any AI fix still running in the background
  // (the Rust task outlives navigating away or refreshing the webview).
  useEffect(() => {
    invoke<string[]>("dependabot_inflight")
      .then((keys) => useDependabotGen.getState().restore(keys))
      .catch(() => {});
  }, []);

  const list = (alerts.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.security_advisory.severity.toLowerCase() as never) -
        SEVERITY_ORDER.indexOf(b.security_advisory.severity.toLowerCase() as never),
    );

  // GitHub returns a raw 403 JSON blob; classify it into a human message instead
  // of dumping the payload. "disabled" (feature off) reads very differently from
  // "forbidden" (you lack access) — the fix is different for each.
  const errText = alerts.error
    ? String((alerts.error as { message?: string })?.message ?? alerts.error)
    : "";
  const errKind: "disabled" | "forbidden" | "other" = /disabled|not enabled/i.test(errText)
    ? "disabled"
    : /\b40[13]\b|forbidden|admin or security|must have admin/i.test(errText)
      ? "forbidden"
      : "other";
  const retryButton = (
    <Button
      size="sm"
      variant="outline"
      loading={alerts.isFetching}
      onClick={() => alerts.refetch()}
    >
      <RefreshCw className="size-3.5" />
      Retry
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dependabot"
        subtitle={
          valid
            ? alerts.isLoading
              ? "Loading alerts…"
              : `${list.length} open alert${list.length === 1 ? "" : "s"} · ${repo}`
            : "Security alerts for a repository"
        }
      />

      <div className="flex items-center gap-2 border-b border-hairline px-6 py-2">
        <span className="text-xs text-muted-foreground">Repository</span>
        <Select value={repo} onValueChange={(v) => setRepo(v ?? "")}>
          <SelectTrigger size="sm" className="w-72 text-xs text-foreground">
            <SelectValue placeholder={repos.isLoading ? "Loading repos…" : "Pick a repository…"} />
          </SelectTrigger>
          <SelectContent>
            {(repos.data ?? []).map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {valid && (
          <div className="ml-auto flex items-center gap-2">
            {alerts.dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                synced {relativeTime(alerts.dataUpdatedAt)}
              </span>
            )}
            <IconButton
              label="Refresh"
              icon={RefreshCw}
              loading={alerts.isFetching}
              onClick={() => alerts.refetch()}
            />
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {!valid ? (
          <EmptyState
            icon={Bot}
            title="Pick a repository"
            description="Enter an owner/repo above to see its open Dependabot security alerts."
          />
        ) : alerts.isLoading ? (
          <div className="space-y-1.5 p-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : alerts.error ? (
          errKind === "disabled" ? (
            <EmptyState
              icon={ShieldOff}
              title="Dependabot isn’t enabled here"
              description={`${repo} doesn’t have Dependabot security alerts turned on. Enable them in the repository’s Security settings on GitHub, then refresh.`}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      safeOpenUrl(`https://github.com/${repo}/settings/security_analysis`)
                    }
                  >
                    <ExternalLink className="size-3.5" />
                    Enable on GitHub
                  </Button>
                  {retryButton}
                </div>
              }
            />
          ) : errKind === "forbidden" ? (
            <EmptyState
              icon={ShieldAlert}
              title="No access to these alerts"
              description={`You need admin or security access to ${repo} to view its Dependabot alerts.`}
              action={retryButton}
            />
          ) : (
            <EmptyState
              icon={ShieldAlert}
              title="Couldn’t load alerts"
              description={`Something went wrong loading alerts for ${repo}.${errText ? ` (${errText})` : ""}`}
              action={retryButton}
            />
          )
        ) : list.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No open alerts"
            description={`${repo} has no open Dependabot security alerts.`}
          />
        ) : (
          <ul className="space-y-2 px-3 py-3">
            {list.map((a) => (
              <AlertRow key={a.number} alert={a} repo={repo} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function AlertRow({ alert, repo }: { alert: DependabotAlert; repo: string }) {
  const sev = alert.security_advisory.severity;
  const pkg = alert.dependency.package?.name ?? "unknown package";
  const ecosystem = alert.dependency.package?.ecosystem;
  const range = alert.security_vulnerability?.vulnerable_version_range;
  const fix = alert.security_vulnerability?.first_patched_version?.identifier;
  const manifest = alert.dependency.manifest_path;

  // The AI fix runs in your local clone of this repo, if you have one.
  const local = useLocalRepos((s) => s.repos.find((r) => `${r.owner}/${r.repo}` === repo));

  // The fix runs in a Rust background task, keyed by alert — so its state and
  // result survive navigating away / refreshing (handled by `dependabot:done`).
  const key = `${repo}#${alert.number}`;
  const fixing = useDependabotGen((s) => !!s.inFlight[key]);
  const prUrl = useDependabotGen((s) => s.result[key]);
  const fixError = useDependabotGen((s) => s.error[key]);

  const [confirmFix, setConfirmFix] = useState(false);

  // The AI branches off whatever base the user picks (default branch by default),
  // so it never stacks on a leftover branch or sweeps in unrelated work.
  const [base, setBase] = useState<string | null>(null);
  const branches = useQuery({
    queryKey: ["branches", local?.path],
    queryFn: () =>
      invoke<{ default: string; branches: string[] }>("gh_list_branches", {
        path: local?.path ?? "",
      }),
    enabled: !!local && confirmFix,
    staleTime: 60_000,
  });
  // Default the base to the repo's default branch once branches load.
  useEffect(() => {
    if (branches.data && base === null) setBase(branches.data.default);
  }, [branches.data, base]);

  function runAiFix() {
    if (!fix || fixing) return;
    if (!local) {
      toast.error(`Clone ${repo} locally first`, {
        description:
          "Add it in the Repositories tab (Clone or Locate…) so the AI can work in your checkout.",
      });
      return;
    }
    setConfirmFix(true);
  }
  function startFix() {
    if (!fix || !local || !base) return;
    useDependabotGen.getState().start(key);
    invoke("gh_dependabot_ai_fix_bg", {
      key,
      path: local.path,
      package: pkg,
      fixedVersion: fix,
      manifestPath: manifest ?? null,
      advisory: alert.security_advisory.summary,
      base,
    }).catch((e) => useDependabotGen.getState().fail(key, String(e)));
  }

  return (
    <li className="group rounded-lg border border-hairline p-3 transition-colors hover:border-border hover:bg-foreground/[0.02]">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("rounded-md px-1.5 py-0.5 font-medium capitalize", severityTone(sev))}>
          {sev}
        </span>
        <span className="font-mono text-foreground">{pkg}</span>
        {ecosystem && <span className="text-muted-foreground">{ecosystem}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Persistent status — stays visible (even without hovering) so a fix
              you kicked off and walked away from still reports back here. */}
          {fixing && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Fixing…
            </span>
          )}
          {!fixing && prUrl && (
            <TooltipFor label="Open the draft PR on GitHub">
              <button
                type="button"
                onClick={() => safeOpenUrl(prUrl)}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-success transition-opacity hover:underline hover:opacity-90"
              >
                <Check className="size-3" />
                Draft PR opened
                <ExternalLink className="size-3" />
              </button>
            </TooltipFor>
          )}
          {!fixing && !prUrl && fixError && (
            <TooltipFor label="Click to see why">
              <button
                type="button"
                onClick={() =>
                  toast.error(`AI fix failed · ${pkg}`, {
                    description: fixError,
                    duration: 12_000,
                  })
                }
                className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive transition-opacity hover:opacity-80"
              >
                <ShieldAlert className="size-3" />
                Fix failed
              </button>
            </TooltipFor>
          )}

          {/* Actions — appear on hover/focus. */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {fix && !fixing && (
              <TooltipFor
                label={
                  local
                    ? "Let AI bump it, run the build/tests, and open a draft PR"
                    : "Needs a local clone — click for how"
                }
              >
                <Button size="xs" variant="ghost" onClick={runAiFix}>
                  <Bot className="size-3.5" />
                  {prUrl || fixError ? "Run again" : "Fix with AI"}
                </Button>
              </TooltipFor>
            )}
            <button
              type="button"
              onClick={() => safeOpenUrl(alert.html_url)}
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              Open
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-xs text-foreground/90">{alert.security_advisory.summary}</p>
      {(range || fix || alert.dependency.manifest_path) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {alert.dependency.manifest_path}
          {range && ` · ${range}`}
          {fix && ` · fixed in ${fix}`}
        </p>
      )}

      <AlertDialog open={confirmFix} onOpenChange={setConfirmFix}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix with AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Let AI bump <span className="font-mono text-foreground">{pkg}</span> to{" "}
              <span className="font-mono text-foreground">{fix}</span>, run your build &amp; tests,
              push a fresh branch off the base you pick, and open a DRAFT PR for you to review.
            </AlertDialogDescription>
            {local && (
              <code className="mt-1 block truncate rounded-md bg-foreground/[0.04] px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {local.path}
              </code>
            )}
            {local && (
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">Branch from</span>
                <Select value={base ?? ""} onValueChange={setBase}>
                  <SelectTrigger size="sm" className="w-full text-xs text-foreground">
                    <SelectValue
                      placeholder={branches.isLoading ? "Loading branches…" : "Pick a base branch…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(branches.data?.branches ?? []).map((b) => (
                      <SelectItem key={b} value={b} className="text-xs">
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              disabled={!base}
              onClick={() => {
                setConfirmFix(false);
                startFix();
              }}
            >
              <Bot className="size-3.5" />
              Fix with AI
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </li>
  );
}
