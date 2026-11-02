import { useEffect, useState } from "react";

import { useFastLanePolicies, type FastLaneWorkspacePolicy } from "@/app/fast-lane";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { run } from "@/effect/runtime";
import { Teams } from "@/effect/services/Teams";
import { Effect } from "effect";

type BooleanPolicyKey =
  | "includeDependabot"
  | "includeRenovate"
  | "requireGreenCi"
  | "excludeDrafts"
  | "excludeConflicts"
  | "excludeChangesRequested"
  | "excludeOpenThreads";

const normalizePaths = (value: ReadonlyArray<string>): string[] => [
  ...new Set(value.map((path) => path.trim()).filter(Boolean)),
];

function PolicyList({
  id,
  label,
  detail,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  detail: string;
  value: ReadonlyArray<string>;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <div>
      <label className="block" htmlFor={id}>
        <span className="block text-[12px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-3">{detail}</span>
      </label>
      <Textarea
        id={id}
        value={value.join("\n")}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value.split("\n"))}
        className="mt-3 [&_textarea]:min-h-24 [&_textarea]:font-mono [&_textarea]:text-[12px] [&_textarea]:leading-5"
      />
    </div>
  );
}

function LimitSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const unlimited = max + step;
  const sliderValue = value === null ? unlimited : Math.min(Math.max(value, min), max);
  const display = value === null ? "No limit" : `${value.toLocaleString()} ${unit}`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-ink">{label}</p>
        <span className="tnum rounded-md bg-raise px-2 py-1 text-[11px] font-medium text-ink-2">
          {display}
        </span>
      </div>
      <Slider
        className="mt-3"
        value={sliderValue}
        min={min}
        max={unlimited}
        step={step}
        disabled={disabled}
        ariaLabel={label}
        ariaValueText={(current) =>
          current === unlimited ? "No limit" : `${current} ${unit}`
        }
        onValueChange={(next) => onChange(next === unlimited ? null : next)}
      />
      <div className="tnum mt-1 flex justify-between text-[10.5px] text-ink-3">
        <span>{min.toLocaleString()}</span>
        <span>No limit</span>
      </div>
    </div>
  );
}

const OPTIONS: ReadonlyArray<{
  key: BooleanPolicyKey;
  label: string;
  detail: string;
}> = [
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
      const next = {
        ...draft,
        trustedAuthors: normalizePaths(draft.trustedAuthors),
        allowedPaths: normalizePaths(draft.allowedPaths),
        blockedPaths: normalizePaths(draft.blockedPaths),
        requiredLabels: normalizePaths(draft.requiredLabels),
        blockedLabels: normalizePaths(draft.blockedLabels),
      };
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
            {organization.displayName ?? organization.login}
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
          <section>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              Trusted automation
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-[1fr_1.35fr]">
              <div className="grid content-start gap-3">
                {(["includeDependabot", "includeRenovate"] as const).map((key) => (
                  <label key={key} className="flex items-center gap-3 text-[12px] text-ink-2">
                    <Checkbox
                      checked={draft[key]}
                      disabled={!canEdit || saving}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({ ...current, [key]: checked === true }))
                      }
                    />
                    {key === "includeDependabot" ? "Dependabot" : "Renovate"}
                  </label>
                ))}
                <p className="text-[11.5px] leading-5 text-ink-3">
                  Built-in shortcuts work across every package ecosystem they support.
                </p>
              </div>
              <PolicyList
                id={`fast-lane-authors-${organization.id}`}
                label="Other trusted authors"
                detail="GitHub login, bot or internal automation. One per line."
                value={draft.trustedAuthors}
                placeholder={"github-actions\nrelease-bot\nacme-automation"}
                disabled={!canEdit || saving}
                onChange={(trustedAuthors) =>
                  setDraft((current) => ({ ...current, trustedAuthors }))
                }
              />
            </div>
          </section>

          <section className="mt-5 border-t border-hair pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              Change limits
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <LimitSlider
                label="Maximum changed files"
                value={draft.maxChangedFiles}
                min={1}
                max={100}
                step={1}
                unit="files"
                disabled={!canEdit || saving}
                onChange={(maxChangedFiles) =>
                  setDraft((current) => ({ ...current, maxChangedFiles }))
                }
              />
              <LimitSlider
                label="Maximum changed lines"
                value={draft.maxChangedLines}
                min={50}
                max={5000}
                step={50}
                unit="lines"
                disabled={!canEdit || saving}
                onChange={(maxChangedLines) =>
                  setDraft((current) => ({ ...current, maxChangedLines }))
                }
              />
            </div>
          </section>

          <section className="mt-5 border-t border-hair pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              Safety checks
            </p>
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
          </section>

          <section className="mt-5 grid gap-5 border-t border-hair pt-4 md:grid-cols-2">
            <PolicyList
              id={`fast-lane-allowed-paths-${organization.id}`}
              label="Allowed paths"
              detail="Every changed file must match at least one glob. Empty allows any path."
              value={draft.allowedPaths}
              placeholder={"docs/**\n**/*.md\nconfig/safe/**"}
              disabled={!canEdit || saving}
              onChange={(allowedPaths) => setDraft((current) => ({ ...current, allowedPaths }))}
            />
            <PolicyList
              id={`fast-lane-blocked-paths-${organization.id}`}
              label="Blocked paths"
              detail="A single matching file keeps the PR in Review requested."
              value={draft.blockedPaths}
              placeholder={"src/auth/**\ndb/migrations/**\n.github/workflows/**"}
              disabled={!canEdit || saving}
              onChange={(blockedPaths) => setDraft((current) => ({ ...current, blockedPaths }))}
            />
          </section>

          <section className="mt-5 grid gap-5 border-t border-hair pt-4 md:grid-cols-2">
            <PolicyList
              id={`fast-lane-required-labels-${organization.id}`}
              label="Required labels"
              detail="All labels listed here must be present. Empty means none required."
              value={draft.requiredLabels}
              placeholder={"automation\nsafe-change"}
              disabled={!canEdit || saving}
              onChange={(requiredLabels) =>
                setDraft((current) => ({ ...current, requiredLabels }))
              }
            />
            <PolicyList
              id={`fast-lane-blocked-labels-${organization.id}`}
              label="Blocked labels"
              detail="Any matching label keeps the PR in Review requested."
              value={draft.blockedLabels}
              placeholder={"security\nbreaking-change\nneeds-design"}
              disabled={!canEdit || saving}
              onChange={(blockedLabels) =>
                setDraft((current) => ({ ...current, blockedLabels }))
              }
            />
          </section>
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
