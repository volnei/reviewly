import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { run, useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import type { Ranked } from "@/effect/services/Triage";
import { useLocalClone } from "@/features/pr/clone";
import { toLocalId } from "@/lib/local-id";
import { safeOpenUrl } from "@/lib/ui";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { ExternalLink, GitBranch, Sparkles } from "lucide-react";
import { useState } from "react";
import { useFixResult } from "./fixes";
import { isWorkspaceFinding, reportText } from "./workspace";

/**
 * `space` on a finding: the advisory in full, what fixes it, and the two
 * things to do about it. The fix runs in your clone and comes back as a PR.
 */
export function FindingPeek({ item }: { item: Ranked }) {
  if (isWorkspaceFinding(item.id)) return <WorkspacePeek item={item} />;
  return <AdvisoryPeek item={item} />;
}

/** A workspace finding: every instance, and the whole report as a prompt for an agent. */
function WorkspacePeek({ item }: { item: Ranked }) {
  const copy = async () => {
    const text = reportText(item.id);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.say(
        "Copied the workspace report",
        "Paste it into your agent; it is a complete work order.",
      );
    } catch (e) {
      toast.fail("Couldn’t copy it", e);
    }
  };
  return (
    <div className="grid max-w-[760px] gap-2 text-[13px]">
      <pre className="selectable whitespace-pre-wrap font-mono text-[12px] leading-[1.5] text-ink-2">
        {item.detail}
      </pre>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="h-7 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          Copy the report as a prompt
        </button>
        <span className="text-[12px] text-ink-3">{item.why}</span>
      </div>
    </div>
  );
}

function AdvisoryPeek({ item }: { item: Ranked }) {
  const clone = useLocalClone(item.owner ?? "", item.repoName ?? "");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const key = `dependabot:${item.id}`;
  const result = useFixResult(key);
  const running = useEffectQuery(
    ["dependabot-inflight"],
    Effect.flatMap(Git, (g) => g.dependabotInflight),
    { refetchInterval: 5000, enabled: !!clone },
  ).data?.includes(key);
  const branches = useEffectQuery(
    ["branches", clone ?? ""],
    Effect.flatMap(Git, (g) => g.branches(clone ?? "")),
    { enabled: !!clone, staleTime: 60_000, retry: false },
  );
  const status = useEffectQuery(
    ["dependabot-status", clone ?? ""],
    Effect.flatMap(Git, (g) => g.status(clone ?? "")),
    { enabled: !!clone, refetchInterval: 5000, retry: false },
  );
  const [base, setBase] = useState<string | null>(null);
  const canFix = !!item.patchedVersion && !!item.packageName;
  const changedFiles = status.data
    ? new Set([...status.data.staged, ...status.data.unstaged].map((file) => file.path)).size
    : 0;
  const openChanges = () => {
    if (!clone) return;
    void navigate({ to: "/local/$id", params: { id: toLocalId(clone) } });
  };
  const fix = async () => {
    if (!clone || !canFix) return;
    setBusy(true);
    try {
      const tree = await run(Effect.flatMap(Git, (g) => g.status(clone)));
      const dirty = new Set([...tree.staged, ...tree.unstaged].map((file) => file.path)).size;
      if (dirty > 0) {
        toast.act(
          "Review local changes first",
          "Open changes",
          openChanges,
          `${dirty} changed file${dirty === 1 ? "" : "s"} would be mixed into this fix.`,
        );
        return;
      }
      await run(
        Effect.flatMap(Git, (g) =>
          g.dependabotFix({
            key,
            path: clone,
            pkg: item.packageName ?? "",
            fixedVersion: item.patchedVersion ?? "",
            manifestPath: item.manifestPath ?? null,
            advisory: item.detail ?? item.title,
            base: base ?? branches.data?.default ?? null,
          }),
        ),
      );
      toast.say(
        `Working on ${item.packageName} in your clone`,
        "You’ll get a toast with the pull request when it’s up.",
      );
    } catch (e) {
      toast.fail("Couldn’t start the fix", e);
    } finally {
      setBusy(false);
    }
  };
  /** The draft PR the fix opened, inside the app when it is one of ours. */
  const openResult = () => {
    const url = result?.url;
    if (!url) return;
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (m)
      void navigate({
        to: "/pr/$owner/$repo/$number",
        params: { owner: m[1], repo: m[2], number: m[3] },
      });
    else safeOpenUrl(url);
  };
  return (
    <div className="finding-peek">
      <div className="finding-peek-head">
        <div className="grid min-w-0 gap-1.5">
          <p className="selectable break-words text-[13px] font-medium leading-[1.45] text-ink">
            {item.detail ?? item.title}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
            <span className={item.patchedVersion ? "text-add" : "text-ink-3"}>
              {item.patchedVersion ? `Patched in ${item.patchedVersion}` : "No patched version yet"}
            </span>
            {item.manifestPath ? (
              <>
                <span className="text-ink-3/50" aria-hidden="true">
                  ·
                </span>
                <span
                  className="max-w-full truncate font-mono text-[11px] text-ink-3"
                  title={item.manifestPath}
                >
                  {item.manifestPath}
                </span>
              </>
            ) : null}
          </div>
        </div>
        {item.url ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => item.url && safeOpenUrl(item.url)}
            className="finding-peek-link text-ink-2"
          >
            GitHub
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
      {result ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-edge/70 bg-sink/45 px-2.5 py-2 text-[12px]">
          {result.ok && result.url ? (
            <>
              <span className="text-ink">The fix is up as a draft pull request.</span>
              <button
                type="button"
                onClick={openResult}
                className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
              >
                Open it
              </button>
            </>
          ) : result.ok ? (
            <span className="text-ink">The fix is in your clone, uncommitted.</span>
          ) : (
            <span className="text-del">
              The fix didn’t land: {result.error ?? "no reason given"}
            </span>
          )}
        </div>
      ) : null}
      {canFix ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-hair pt-3">
          <Button
            size="sm"
            disabled={!clone || busy || running || changedFiles > 0}
            loading={busy || !!running}
            onClick={fix}
          >
            <Sparkles className="size-3.5" strokeWidth={1.75} />
            {running ? "Working…" : busy ? "Starting…" : result ? "Run again" : "Fix with AI"}
          </Button>
          {clone && changedFiles > 0 ? (
            <button
              type="button"
              onClick={openChanges}
              className="text-[11.5px] text-del underline decoration-del/45 underline-offset-2 hover:text-ink"
            >
              Review {changedFiles} local change{changedFiles === 1 ? "" : "s"}
            </button>
          ) : null}
          {clone && branches.data ? (
            <div className="flex h-7 min-w-0 items-center rounded-md border border-edge bg-page/35 text-[11.5px] text-ink-3">
              <span className="flex h-full shrink-0 items-center gap-1.5 border-r border-hair px-2">
                <GitBranch className="size-3.5" strokeWidth={1.75} />
                Base
              </span>
              <Select
                value={base ?? branches.data.default}
                onValueChange={(value) => {
                  if (value !== null) setBase(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Base branch"
                  className="h-full min-h-0 w-auto min-w-24 max-w-48 rounded-none border-0 bg-transparent px-2 text-ink shadow-none focus-visible:ring-0 dark:bg-transparent"
                >
                  <SelectValue>{base ?? branches.data.default}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {[...new Set([branches.data.default, ...branches.data.branches])].map(
                    (branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ),
                  )}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          {!clone ? (
            <span className="text-[11.5px] text-ink-3">Clone required for automatic fixes</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
