import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import {
  BookOpenCheck,
  Braces,
  Check,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  Play,
  Plus,
  Save,
  TerminalSquare,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTeamsPlan } from "@/app/teams-billing";
import { useTeamsWorkspace } from "@/app/teams-workspace";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { useWorkspace } from "@/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { run, useEffectQuery } from "@/effect/runtime";
import * as S from "@/effect/schema";
import type { CommandRunResult, TeamEnvironment } from "@/effect/schema";
import { Git } from "@/effect/services/Git";
import { prefsStore, type ReviewSkill, usePrefs } from "@/effect/services/Prefs";
import { Teams } from "@/effect/services/Teams";
import { Tauri } from "@/effect/Tauri";
import {
  deletePersonalEnvironment,
  environmentsStore,
  type PersonalEnvironment,
  type PersonalEnvironmentCommand,
  type PersonalEnvironmentVariable,
  savePersonalEnvironment,
  setTeamEnvironmentDirectory,
  usePersonalEnvironments,
} from "@/features/environments/store";
import { ReviewSkillsEditor } from "@/features/review-skills-settings";
import { APP_STORE } from "@/lib/edition";
import { scopeReviewSkillsToRepositories } from "@/lib/review-skills";
import { cn } from "@/lib/utils";

type Scope = "personal" | string;
type Tab = "variables" | "commands" | "skills";
type DraftVariable = PersonalEnvironmentVariable & {
  readonly persistedId?: string;
  readonly importedFrom?: string;
};
type DraftCommand = PersonalEnvironmentCommand;
type Draft = {
  readonly id: string;
  readonly name: string;
  readonly repository: string | null;
  readonly localDirectory: string;
  readonly variables: ReadonlyArray<DraftVariable>;
  readonly commands: ReadonlyArray<DraftCommand>;
};
type EnvironmentImport = {
  readonly directory: string;
  readonly loading: boolean;
  readonly count: number;
  readonly sources: ReadonlyArray<string>;
};

const id = () => crypto.randomUUID();
const slugOf = (remote: string | null | undefined) =>
  remote
    ?.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)
    ?.slice(1, 3)
    .join("/") ?? null;

const blank = (repository: string | null): Draft => ({
  id: id(),
  name: "New environment",
  repository,
  localDirectory: "",
  variables: [],
  commands: [],
});

const fromPersonal = (environment: PersonalEnvironment): Draft => ({ ...environment });

const fromTeam = (environment: TeamEnvironment, localDirectory: string): Draft => ({
  id: environment.id,
  name: environment.name,
  repository: environment.repository,
  localDirectory,
  variables: environment.variables.map((variable) => ({
    id: variable.id,
    persistedId: variable.id,
    key: variable.key,
    value: "",
    secret: variable.secret,
  })),
  commands: environment.commands,
});

export function EnvironmentsScreen() {
  const teamsPlan = useTeamsPlan();
  const teamsWorkspace = useTeamsWorkspace();
  const repository = useWorkspace();
  const localPaths = usePrefs((prefs) => prefs.localRepos);
  const reviewSkills = usePrefs((prefs) => prefs.reviewSkills);
  const localRepositories = useEffectQuery(
    ["environment-local-repositories", localPaths],
    Effect.forEach(
      localPaths,
      (path) =>
        Effect.flatMap(Git, (git) => git.repoInfo(path)).pipe(
          Effect.map((info) => ({ path, repository: slugOf(info.remote_url) })),
          Effect.orElseSucceed(() => ({ path, repository: null })),
        ),
      { concurrency: 4 },
    ),
    { enabled: localPaths.length > 0, staleTime: 60_000 },
  );
  const personal = usePersonalEnvironments();
  const [scope, setScope] = useState<Scope>("personal");
  const organizationId = scope === "personal" ? null : scope;
  const teamQuery = useEffectQuery(
    ["teams", "environments", organizationId],
    Effect.flatMap(Teams, (service) => service.environments(organizationId ?? "")),
    { enabled: teamsPlan === "teams" && !!organizationId, staleTime: 15_000 },
  );
  const teamEnvironments = useMemo(
    () => teamQuery.data?.environments ?? [],
    [teamQuery.data?.environments],
  );
  const scopedPersonal = useMemo(
    () =>
      personal.filter(
        (environment) =>
          !repository || !environment.repository || environment.repository === repository,
      ),
    [personal, repository],
  );
  const scopedTeam = useMemo(
    () =>
      teamEnvironments.filter(
        (environment) =>
          !repository || !environment.repository || environment.repository === repository,
      ),
    [teamEnvironments, repository],
  );
  const environments = scope === "personal" ? scopedPersonal : scopedTeam;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    environments.find((environment) => environment.id === selectedId) ?? environments[0];
  const [draft, setDraft] = useState<Draft>(() => blank(repository));
  const [creating, setCreating] = useState(personal.length === 0);
  const [tab, setTab] = useState<Tab>("variables");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<CommandRunResult | null>(null);
  const [environmentImport, setEnvironmentImport] = useState<EnvironmentImport | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const repositories = (localRepositories.data ?? []).flatMap((item) =>
      item.repository ? [item.repository] : [],
    );
    if (!repositories.length) return;
    const scoped = scopeReviewSkillsToRepositories(reviewSkills, repositories);
    if (JSON.stringify(scoped) === JSON.stringify(reviewSkills)) return;
    prefsStore.update((prefs) => ({ ...prefs, reviewSkills: scoped }));
  }, [localRepositories.data, reviewSkills]);

  useEffect(() => {
    if (tab === "skills" && !draft.repository) setTab("variables");
  }, [draft.repository, tab]);

  const projectReviewSkills = useMemo(
    () =>
      draft.repository
        ? reviewSkills.filter(
            (skill) =>
              skill.repositories.length === 1 &&
              skill.repositories[0].toLowerCase() === draft.repository?.toLowerCase(),
          )
        : [],
    [draft.repository, reviewSkills],
  );
  const setProjectReviewSkills = (skills: ReviewSkill[]) => {
    if (!draft.repository) return;
    const repository = draft.repository;
    prefsStore.update((prefs) => ({
      ...prefs,
      reviewSkills: [
        ...prefs.reviewSkills.filter(
          (skill) =>
            !(
              skill.repositories.length === 1 &&
              skill.repositories[0].toLowerCase() === repository.toLowerCase()
            ),
        ),
        ...skills.map((skill) => ({ ...skill, repositories: [repository] })),
      ],
    }));
  };

  useEffect(() => {
    if (!creating || draft.localDirectory || !draft.repository) return;
    const localRepository = localRepositories.data?.find(
      (item) => item.repository === draft.repository,
    );
    if (!localRepository) return;
    setDraft((current) =>
      current.repository === localRepository.repository && !current.localDirectory
        ? { ...current, localDirectory: localRepository.path }
        : current,
    );
  }, [creating, draft.localDirectory, draft.repository, localRepositories.data]);

  useEffect(() => {
    if (!creating || !draft.localDirectory) {
      setEnvironmentImport(null);
      return;
    }

    const directory = draft.localDirectory;
    let active = true;
    setEnvironmentImport({ directory, loading: true, count: 0, sources: [] });
    void run(
      Effect.flatMap(Tauri, (tauri) =>
        tauri.invoke("environment_file_values", { cwd: directory }, S.EnvironmentFileValues),
      ),
    )
      .then((imported) => {
        if (!active) return;
        setDraft((current) => {
          if (current.localDirectory !== directory) return current;
          const manualVariables = current.variables.filter((variable) => !variable.importedFrom);
          const manualKeys = new Set(manualVariables.map((variable) => variable.key));
          return {
            ...current,
            variables: [
              ...manualVariables,
              ...imported.variables
                .filter((variable) => !manualKeys.has(variable.key))
                .map((variable) => ({
                  id: id(),
                  key: variable.key,
                  value: variable.value,
                  secret: true,
                  importedFrom: variable.source,
                })),
            ],
          };
        });
        setEnvironmentImport({
          directory,
          loading: false,
          count: imported.variables.length,
          sources: imported.sources,
        });
      })
      .catch((error) => {
        if (!active) return;
        setDraft((current) =>
          current.localDirectory === directory
            ? {
                ...current,
                variables: current.variables.filter((variable) => !variable.importedFrom),
              }
            : current,
        );
        setEnvironmentImport({ directory, loading: false, count: 0, sources: [] });
        toast.fail("Couldn’t import the repository environment", error);
      });

    return () => {
      active = false;
    };
  }, [creating, draft.localDirectory]);

  useTitleSlot(
    <>
      <span className="text-[12px] text-ink-3">
        {repository ? `Scoped to ${repository}` : "Reusable command environments"}
      </span>
      <span className="flex-1" />
      <ScopeSelect
        scope={scope}
        onScopeChange={(next) => {
          setScope(next);
          setSelectedId(null);
          setCreating(false);
          setDraft(blank(repository));
          setResult(null);
        }}
        organizations={teamsWorkspace.organizations}
        teamsEnabled={teamsPlan === "teams"}
      />
    </>,
    "desk",
  );

  useEffect(() => {
    if (creating || !selected) return;
    setSelectedId(selected.id);
    setDraft(
      scope === "personal"
        ? fromPersonal(selected as PersonalEnvironment)
        : fromTeam(
            selected as TeamEnvironment,
            environmentsStore.get().teamDirectories[selected.id] ?? "",
          ),
    );
    setResult(null);
  }, [creating, scope, selected]);

  const canEdit = scope === "personal" || teamQuery.data?.canEdit === true;
  const save = async () => {
    const name = draft.name.trim();
    if (!name) return toast.fail("Name this environment");
    if (draft.variables.some((variable) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key))) {
      return toast.fail("Environment keys must use letters, numbers, and underscores");
    }
    if (draft.commands.some((command) => !command.name.trim() || !command.command.trim())) {
      return toast.fail("Every command needs a name and command line");
    }
    setSaving(true);
    try {
      if (scope === "personal") {
        const previous = personal.find((environment) => environment.id === draft.id);
        const previousSecrets = previous?.variables.filter((variable) => variable.secret) ?? [];
        const currentKeys = new Set(draft.variables.map((variable) => variable.key));
        const removedSecrets = previousSecrets.filter((variable) => !currentKeys.has(variable.key));
        const newSecretsWithoutValues = draft.variables.filter(
          (variable) =>
            variable.secret &&
            !variable.value &&
            !previousSecrets.some((previousVariable) => previousVariable.key === variable.key),
        );
        if (newSecretsWithoutValues.length) {
          return toast.fail(`Enter a value for ${newSecretsWithoutValues[0].key || "the secret"}`);
        }
        const secrets = draft.variables
          .filter((variable) => variable.secret && variable.value.length > 0)
          .map((variable) => ({ key: variable.key, value: variable.value, secret: true }));
        if (secrets.length) {
          await run(
            Effect.flatMap(Tauri, (tauri) =>
              tauri.invoke(
                "environment_values_save",
                { environmentId: draft.id, values: secrets },
                S.Unit,
              ),
            ),
          );
        }
        for (const variable of removedSecrets) {
          await run(
            Effect.flatMap(Tauri, (tauri) =>
              tauri.invoke(
                "environment_value_delete",
                { environmentId: draft.id, key: variable.key },
                S.Unit,
              ),
            ),
          );
        }
        savePersonalEnvironment({
          ...draft,
          name,
          variables: draft.variables.map((variable) => ({
            id: variable.id,
            key: variable.key,
            secret: variable.secret,
            value: variable.secret ? "" : variable.value,
          })),
          updatedAt: new Date().toISOString(),
        });
        setSelectedId(draft.id);
      } else {
        const payload = {
          name,
          repository: draft.repository,
          variables: draft.variables.map((variable) => ({
            ...(variable.persistedId ? { id: variable.persistedId } : {}),
            key: variable.key,
            secret: variable.secret,
            ...(variable.value ? { value: variable.value } : {}),
          })),
          commands: draft.commands.map((command) => ({
            id: command.id,
            name: command.name,
            command: command.command,
            workingDirectory: command.workingDirectory,
            timeoutSeconds: command.timeoutSeconds,
          })),
        };
        const savedId = await run(
          Effect.flatMap(Teams, (service) =>
            creating
              ? service.createEnvironment(scope, payload)
              : service.updateEnvironment(scope, draft.id, payload).pipe(Effect.as(draft.id)),
          ),
        );
        setTeamEnvironmentDirectory(savedId, draft.localDirectory);
        setSelectedId(savedId);
        await queryClient.invalidateQueries({ queryKey: ["teams", "environments", scope] });
      }
      setCreating(false);
      toast.done("Environment saved");
    } catch (error) {
      toast.fail("Couldn’t save the environment", error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${draft.name}? This cannot be undone.`)) return;
    try {
      if (scope === "personal") {
        for (const variable of draft.variables.filter((item) => item.secret)) {
          await run(
            Effect.flatMap(Tauri, (tauri) =>
              tauri.invoke(
                "environment_value_delete",
                { environmentId: draft.id, key: variable.key },
                S.Unit,
              ),
            ),
          );
        }
        deletePersonalEnvironment(draft.id);
      } else {
        await run(Effect.flatMap(Teams, (service) => service.deleteEnvironment(scope, draft.id)));
        await queryClient.invalidateQueries({ queryKey: ["teams", "environments", scope] });
      }
      setSelectedId(null);
      setCreating(false);
      toast.done("Environment deleted");
    } catch (error) {
      toast.fail("Couldn’t delete the environment", error);
    }
  };

  const execute = async (command: DraftCommand) => {
    if (!draft.localDirectory.trim()) return toast.fail("Choose a local directory first");
    setRunning(command.id);
    setResult(null);
    try {
      const answer = await run(
        scope === "personal"
          ? Effect.flatMap(Tauri, (tauri) =>
              tauri.invoke(
                "environment_command_run",
                {
                  environmentId: draft.id,
                  cwd: draft.localDirectory,
                  command: command.command,
                  values: draft.variables.map((variable) => ({
                    key: variable.key,
                    value: variable.value,
                    secret: variable.secret,
                  })),
                  timeoutSeconds: command.timeoutSeconds,
                },
                S.CommandRunResult,
              ),
            )
          : Effect.flatMap(Teams, (service) =>
              service.runEnvironmentCommand(scope, draft.id, command.id, draft.localDirectory),
            ),
      );
      setResult(answer);
      answer.success
        ? toast.done(`${command.name} completed`)
        : toast.fail(`${command.name} failed`);
    } catch (error) {
      toast.fail("Couldn’t run the command", error);
    } finally {
      setRunning(null);
    }
  };

  return (
    <main className="h-full min-h-0 bg-desk text-ink">
      <div className="mx-auto flex h-full min-h-0 max-w-[1440px] gap-4 p-5">
        <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-hair bg-panel/75">
          <div className="border-b border-hair p-3">
            <Button
              className="w-full justify-start rounded-xl"
              variant="outline"
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
                setDraft(blank(repository));
                setResult(null);
              }}
              disabled={scope !== "personal" && !canEdit}
            >
              <Plus className="size-4" /> New environment
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {environments.length ? (
              <div className="space-y-1">
                {environments.map((environment) => (
                  <button
                    key={environment.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                      !creating && selected?.id === environment.id
                        ? "bg-raise text-ink"
                        : "text-ink-2 hover:bg-raise/55 hover:text-ink",
                    )}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(environment.id);
                    }}
                  >
                    {scope === "personal" ? (
                      <Braces className="size-4" />
                    ) : (
                      <UsersRound className="size-4" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {environment.name}
                      </span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {environment.repository ?? "Any repository"}
                      </span>
                    </span>
                    <ChevronRight className="size-3.5 text-ink-3" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-10 text-center text-[12px] leading-relaxed text-ink-3">
                No environments for {repository ?? "this scope"} yet.
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto rounded-2xl border border-hair bg-panel/75">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-hair bg-panel px-6 py-4">
            <div className="min-w-0 flex-1">
              <input
                aria-label="Environment name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                disabled={!canEdit}
                className="block w-full max-w-[640px] truncate border-0 bg-transparent p-0 text-[18px] font-semibold leading-7 text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
              />
              <p className="mt-1 text-[12px] text-ink-3">
                {scope === "personal"
                  ? "Local to this Mac · included in Hobby"
                  : "Shared with this Teams workspace"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!creating && canEdit ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete environment"
                  onClick={() => void remove()}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
              {canEdit ? (
                <Button className="rounded-xl" onClick={() => void save()} disabled={saving}>
                  <Save className="size-4" /> {saving ? "Saving…" : "Save"}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-6 p-6">
            <div className="overflow-hidden rounded-2xl border border-hair">
              <div className="grid gap-3 px-4 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                <div>
                  <Label className="text-[12px] text-ink">Project</Label>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Choose a local repository already added to Reviewly.
                  </p>
                </div>
                <Select
                  value={draft.localDirectory || "__any__"}
                  onValueChange={(path) => {
                    if (!path) return;
                    if (path === "__any__") {
                      setDraft({ ...draft, repository: null, localDirectory: "" });
                      return;
                    }
                    const selectedRepository = localRepositories.data?.find(
                      (item) => item.path === path,
                    );
                    setDraft({
                      ...draft,
                      repository:
                        scope === "personal" || canEdit
                          ? (selectedRepository?.repository ?? null)
                          : draft.repository,
                      localDirectory: path,
                    });
                  }}
                >
                  <SelectTrigger className="w-full rounded-xl" aria-label="Project repository">
                    <SelectValue>
                      {draft.repository ??
                        (draft.localDirectory
                          ? draft.localDirectory.split(/[\\/]/).pop()
                          : "Any repository")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false} className="min-w-[360px]">
                    <SelectItem value="__any__">Any repository</SelectItem>
                    {(localRepositories.data ?? [])
                      .filter(
                        (item) =>
                          scope === "personal" ||
                          canEdit ||
                          !draft.repository ||
                          item.repository === draft.repository,
                      )
                      .map((item) => (
                        <SelectItem key={item.path} value={item.path}>
                          <span className="flex min-w-0 flex-col py-0.5">
                            <span className="truncate text-[12px] text-ink">
                              {item.repository ?? item.path.split(/[\\/]/).pop()}
                            </span>
                            <span className="truncate font-mono text-[10px] text-ink-3">
                              {item.path}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="grid gap-3 border-t border-hair px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                <div>
                  <p className="text-[12px] text-ink-2">Local directory</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">Private to this Mac.</p>
                </div>
                <p className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">
                  {draft.localDirectory || "Choose a project above"}
                </p>
              </div>
            </div>

            <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
              <TabsList className="rounded-xl">
                <TabsTab value="variables">
                  <KeyRound className="size-3.5" /> Variables
                </TabsTab>
                <TabsTab value="commands">
                  <TerminalSquare className="size-3.5" /> Commands
                </TabsTab>
                <TabsTab value="skills" disabled={!draft.repository}>
                  <BookOpenCheck className="size-3.5" /> Review skills
                </TabsTab>
              </TabsList>
            </Tabs>

            {tab === "variables" ? (
              <VariablesEditor
                draft={draft}
                setDraft={setDraft}
                canEdit={canEdit}
                environmentImport={environmentImport}
              />
            ) : tab === "commands" ? (
              <CommandsEditor
                draft={draft}
                setDraft={setDraft}
                canEdit={canEdit}
                running={running}
                onRun={execute}
              />
            ) : draft.repository ? (
              <div className="overflow-hidden rounded-2xl border border-hair">
                <div className="border-b border-hair px-4 py-3">
                  <p className="text-[13px] font-medium">Project review skills</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Applied automatically to reviews in {draft.repository}. Changes save
                    immediately.
                  </p>
                </div>
                <div className="p-4">
                  <ReviewSkillsEditor
                    skills={projectReviewSkills}
                    onChange={setProjectReviewSkills}
                    repository={draft.repository}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ) : null}

            {APP_STORE && tab === "commands" ? (
              <p className="rounded-xl border border-hair bg-raise/35 px-4 py-3 text-[12px] text-ink-2">
                Local command execution is available in the direct download, including the free
                Hobby plan.
              </p>
            ) : null}

            {result ? <RunOutput result={result} /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function ScopeSelect({
  scope,
  onScopeChange,
  organizations,
  teamsEnabled,
}: {
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  organizations: ReadonlyArray<{ id: string; login: string; displayName: string | null }>;
  teamsEnabled: boolean;
}) {
  const selectedOrganization = organizations.find((organization) => organization.id === scope);
  const label =
    scope === "personal"
      ? "Personal · Hobby"
      : `${selectedOrganization?.displayName ?? selectedOrganization?.login ?? "Teams"} · Teams`;
  return (
    <Select value={scope} onValueChange={(value) => value && onScopeChange(value)}>
      <SelectTrigger size="sm" className="min-w-40 rounded-xl" aria-label="Environment workspace">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem value="personal">Personal · Hobby</SelectItem>
        {teamsEnabled
          ? organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.displayName ?? organization.login} · Teams
              </SelectItem>
            ))
          : null}
      </SelectPopup>
    </Select>
  );
}

function VariablesEditor({
  draft,
  setDraft,
  canEdit,
  environmentImport,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  canEdit: boolean;
  environmentImport: EnvironmentImport | null;
}) {
  const add = () =>
    setDraft({
      ...draft,
      variables: [...draft.variables, { id: id(), key: "", value: "", secret: true }],
    });
  return (
    <div className="overflow-hidden rounded-2xl border border-hair">
      <div className="flex items-center justify-between border-b border-hair px-4 py-3">
        <div>
          <p className="text-[13px] font-medium">Environment variables</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {environmentImport?.loading
              ? "Reading .env files from the selected repository…"
              : environmentImport?.count
                ? `${environmentImport.count} loaded from ${environmentImport.sources.join(", ")}. Secrets stay protected.`
                : environmentImport
                  ? "No .env.example, .env, or .env.local found. Add variables manually."
                  : "Secret values are stored in Keychain or encrypted for Teams."}
          </p>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" className="rounded-xl" onClick={add}>
            <Plus className="size-3.5" /> Add variable
          </Button>
        ) : null}
      </div>
      {draft.variables.length ? (
        draft.variables.map((variable, index) => (
          <div
            key={variable.id}
            className="grid items-center gap-3 border-b border-hair px-4 py-3 last:border-b-0 md:grid-cols-[minmax(160px,.7fr)_minmax(220px,1fr)_100px_32px]"
          >
            <Input
              value={variable.key}
              placeholder="DATABASE_URL"
              disabled={!canEdit}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  variables: draft.variables.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, key: event.target.value.toUpperCase() } : item,
                  ),
                })
              }
              className="rounded-xl font-mono text-[12px]"
            />
            <Input
              type={variable.secret ? "password" : "text"}
              value={variable.value}
              placeholder={
                variable.persistedId || (variable.secret && !variable.value)
                  ? "Leave blank to keep current value"
                  : "Value"
              }
              disabled={!canEdit}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  variables: draft.variables.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: event.target.value } : item,
                  ),
                })
              }
              className="rounded-xl font-mono text-[12px]"
            />
            <label className="flex items-center gap-2 text-[11px] text-ink-2">
              <Switch
                checked={variable.secret}
                disabled={!canEdit}
                onCheckedChange={(secret) =>
                  setDraft({
                    ...draft,
                    variables: draft.variables.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, secret } : item,
                    ),
                  })
                }
              />
              Secret
            </label>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${variable.key || "variable"}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    variables: draft.variables.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <X className="size-4" />
              </Button>
            ) : (
              <LockKeyhole className="size-3.5 text-ink-3" />
            )}
          </div>
        ))
      ) : (
        <EmptyRow label="No variables yet." />
      )}
    </div>
  );
}

function CommandsEditor({
  draft,
  setDraft,
  canEdit,
  running,
  onRun,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  canEdit: boolean;
  running: string | null;
  onRun: (command: DraftCommand) => void;
}) {
  const add = () =>
    setDraft({
      ...draft,
      commands: [
        ...draft.commands,
        { id: id(), name: "", command: "", workingDirectory: "", timeoutSeconds: 300 },
      ],
    });
  return (
    <div className="overflow-hidden rounded-2xl border border-hair">
      <div className="flex items-center justify-between border-b border-hair px-4 py-3">
        <div>
          <p className="text-[13px] font-medium">Commands</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Available on Hobby. Teams adds sharing and access control.
          </p>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" className="rounded-xl" onClick={add}>
            <Plus className="size-3.5" /> Add command
          </Button>
        ) : null}
      </div>
      {draft.commands.length ? (
        draft.commands.map((command, index) => (
          <div
            key={command.id}
            className="grid items-center gap-3 border-b border-hair px-4 py-3 last:border-b-0 md:grid-cols-[180px_minmax(260px,1fr)_80px_36px_32px]"
          >
            <Input
              value={command.name}
              placeholder="Run tests"
              disabled={!canEdit}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  commands: draft.commands.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: event.target.value } : item,
                  ),
                })
              }
              className="rounded-xl"
            />
            <Input
              value={command.command}
              placeholder="bun test"
              disabled={!canEdit}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  commands: draft.commands.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, command: event.target.value } : item,
                  ),
                })
              }
              className="rounded-xl font-mono text-[12px]"
            />
            <Input
              type="number"
              min={1}
              max={3600}
              value={command.timeoutSeconds}
              disabled={!canEdit}
              aria-label={`${command.name || "Command"} timeout in seconds`}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  commands: draft.commands.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, timeoutSeconds: Number(event.target.value) || 300 }
                      : item,
                  ),
                })
              }
              className="rounded-xl text-right"
            />
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-xl"
              aria-label={`Run ${command.name || "command"}`}
              disabled={!!running || APP_STORE || !command.command.trim()}
              onClick={() => onRun(command)}
            >
              {running === command.id ? (
                <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Play className="size-3.5" />
              )}
            </Button>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${command.name || "command"}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    commands: draft.commands.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ))
      ) : (
        <EmptyRow label="No commands yet." />
      )}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-4 py-8 text-center text-[12px] text-ink-3">{label}</p>;
}

function RunOutput({ result }: { result: CommandRunResult }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-hair bg-[#0b0d0e] text-[#e7e7e2]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[11px]">
        {result.success ? (
          <Check className="size-3.5 text-green-400" />
        ) : (
          <X className="size-3.5 text-red-400" />
        )}
        <span>
          {result.success ? "Completed" : `Exited ${result.exitCode ?? "without a status"}`}
        </span>
        <span className="ml-auto text-white/45">{result.durationMs} ms</span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed">
        {result.stdout}
        {result.stderr ? `\n${result.stderr}` : ""}
      </pre>
    </div>
  );
}
