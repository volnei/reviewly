import { useEffect, useState } from "react";

import { useFastLanePolicies, type FastLaneWorkspacePolicy } from "@/app/fast-lane";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { run } from "@/effect/runtime";
import type { FastLanePolicy } from "@/effect/schema";
import { Teams } from "@/effect/services/Teams";
import { Effect } from "effect";

type BooleanPolicyKey = Exclude<keyof FastLanePolicy, "enabled" | "blockedPaths">;

const normalizePaths = (value: ReadonlyArray<string>): string[] => [
  ...new Set(value.map((path) => path.trim()).filter(Boolean)),
];

const OPTIONS: ReadonlyArray<{
  key: BooleanPolicyKey;
  label: string;
  detail: string;
}> = [
  {
    key: "includeDependabot",
    label: "Dependabot",
    detail: "Allow dependency updates opened by Dependabot.",
  },
  {
    key: "includeRenovate",
    label: "Renovate",
    detail: "Allow dependency updates opened by Renovate.",
  },
  {
    key: "requireGreenCi",
    label: "Require green CI",
    detail: "Keep pending and failing checks in Review requested.",
  },
  {
    key: "excludeDrafts",
    label: "Exclude drafts",
    detail: "Only classify pull requests marked ready for review.",
  },
  {
    key: "excludeConflicts",
    label: "Exclude conflicts",
    detail: "Never move a pull request that conflicts with its base.",
  },
  {
    key: "excludeChangesRequested",
    label: "Exclude changes requested",
    detail: "Keep pull requests with requested changes in the main queue.",
  },
  {
    key: "excludeOpenThreads",
    label: "Exclude open threads",
    detail: "Keep unresolved review conversations visible.",
  },
];

function WorkspacePolicy({
  value,
  refresh,
}: {
  value: FastLaneWorkspacePolicy;
  refresh: () => Promise<unknown>;
}) {
  const { organization, policy } = value;
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const canEdit = organization.role === "owner" || organization.role === "admin";
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  useEffect(() => setDraft(policy), [policy]);

  const save = async () => {
    if (!canEdit || !dirty || saving) return;
    setSaving(true);
    try {
      const next = { ...draft, blockedPaths: normalizePaths(draft.blockedPaths) };
      await run(
        Effect.flatMap(Teams, (service) =>
          service.updateFastLanePolicy(organization.id, next),
        ),
      );
      await refresh();
      toast.done("Fast lane policy saved", `@${organization.login}`);
    } catch (error) {
      toast.fail("Couldn’t save Fast lane", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="border-b border-hair last:border-b-0">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-raise text-[12px] font-medium text-ink-2">
          {organization.login.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">
            {organization.display_name ?? organization.login}
          </p>
          <span className="text-[11.5px] text-ink-3">
            @{organization.login} · {canEdit ? "team policy" : "managed by an admin"}
          </span>
        </div>
        <label className="flex items-center gap-3 text-[12px] text-ink-2">
          Enable Fast lane
          <Switch
            checked={draft.enabled}
            disabled={!canEdit || saving}
            onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            aria-label={`Enable Fast lane for ${organization.login}`}
          />
        </label>
      </div>

      {draft.enabled ? (
        <div className="border-t border-hair bg-raise/15 px-5 py-5">
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {OPTIONS.map((option) => (
              <label key={option.key} className="flex items-start gap-3">
                <Checkbox
                  checked={draft[option.key]}
                  disabled={!canEdit || saving}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, [option.key]: checked === true }))
                  }
                  aria-label={option.label}
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-3">
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-5 border-t border-hair pt-4">
            <label className="block" htmlFor={`fast-lane-paths-${organization.id}`}>
              <span className="block text-[12px] font-medium text-ink">Blocked paths</span>
              <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-3">
                One glob per line. A matching file keeps the PR in Review requested.
              </span>
            </label>
            <Textarea
              id={`fast-lane-paths-${organization.id}`}
              value={draft.blockedPaths.join("\n")}
              disabled={!canEdit || saving}
              spellCheck={false}
              placeholder={"src/auth/**\ndb/migrations/**\n**/*.sql\n.github/workflows/**"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  blockedPaths: event.target.value.split("\n"),
                }))
              }
              className="mt-3 [&_textarea]:min-h-28 [&_textarea]:font-mono [&_textarea]:text-[12px] [&_textarea]:leading-5"
            />
          </div>
          {canEdit ? (
            <div className="mt-5 flex items-center justify-between border-t border-hair pt-4">
              <p className="text-[11.5px] text-ink-3">
                Matching PRs move sections only. Reviewly never approves or merges them.
              </p>
              <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save policy"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function FastLaneSettings() {
  const policies = useFastLanePolicies();

  return (
    <Card className="settings-card">
      <div className="settings-card-heading">
        <h2>Fast lane</h2>
        <p>Let each workspace define which routine PRs leave the main review queue.</p>
      </div>
      <div className="settings-card-body p-0">
        {policies.isPending ? (
          <p className="px-5 py-5 text-[12px] text-ink-3">Loading Fast lane policies…</p>
        ) : policies.isError ? (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-[12px] text-ink-3">Couldn’t load Fast lane policies.</p>
            <Button variant="ghost" size="sm" onClick={() => void policies.refetch()}>
              Retry
            </Button>
          </div>
        ) : policies.data?.length ? (
          policies.data.map((value) => (
            <WorkspacePolicy
              key={value.organization.id}
              value={value}
              refresh={policies.refetch}
            />
          ))
        ) : (
          <p className="px-5 py-5 text-[12px] text-ink-3">
            An active Teams workspace is required to configure Fast lane.
          </p>
        )}
      </div>
    </Card>
  );
}
