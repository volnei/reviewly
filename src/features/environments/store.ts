import { persistedStore, useStore } from "@/effect/store";

export interface PersonalEnvironmentVariable {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly secret: boolean;
  readonly source?: string;
}

export interface PersonalEnvironmentCommand {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly workingDirectory: string;
  readonly timeoutSeconds: number;
}

export interface PersonalEnvironment {
  readonly id: string;
  readonly name: string;
  readonly repository: string | null;
  readonly localDirectory: string;
  readonly variables: ReadonlyArray<PersonalEnvironmentVariable>;
  readonly commands: ReadonlyArray<PersonalEnvironmentCommand>;
  readonly updatedAt: string;
}

interface EnvironmentState {
  readonly environments: ReadonlyArray<PersonalEnvironment>;
  readonly teamDirectories: Readonly<Record<string, string>>;
}

const fallback: EnvironmentState = { environments: [], teamDirectories: {} };

function decode(raw: unknown): EnvironmentState {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Partial<EnvironmentState>;
  return {
    environments: Array.isArray(value.environments)
      ? (value.environments as ReadonlyArray<PersonalEnvironment>)
      : [],
    teamDirectories:
      value.teamDirectories && typeof value.teamDirectories === "object"
        ? (value.teamDirectories as Readonly<Record<string, string>>)
        : {},
  };
}

export const environmentsStore = persistedStore<EnvironmentState>(
  "reviewly.v2.environments",
  fallback,
  decode,
);

export const usePersonalEnvironments = () =>
  useStore(environmentsStore, (state) => state.environments);

export const useTeamEnvironmentDirectory = (environmentId: string | null) =>
  useStore(
    environmentsStore,
    (state) => (environmentId ? state.teamDirectories[environmentId] : undefined) ?? "",
  );

export function personalSecretKeysToDelete(
  previous: ReadonlyArray<Pick<PersonalEnvironmentVariable, "key" | "secret">>,
  current: ReadonlyArray<Pick<PersonalEnvironmentVariable, "key" | "secret">>,
): ReadonlyArray<string> {
  const currentSecrets = new Set(
    current.filter((variable) => variable.secret).map((variable) => variable.key),
  );
  return previous
    .filter((variable) => variable.secret && !currentSecrets.has(variable.key))
    .map((variable) => variable.key);
}

export function savePersonalEnvironment(environment: PersonalEnvironment) {
  environmentsStore.update((state) => ({
    ...state,
    environments: state.environments.some((item) => item.id === environment.id)
      ? state.environments.map((item) => (item.id === environment.id ? environment : item))
      : [...state.environments, environment],
  }));
}

export function deletePersonalEnvironment(id: string) {
  environmentsStore.update((state) => ({
    ...state,
    environments: state.environments.filter((environment) => environment.id !== id),
  }));
}

export function setTeamEnvironmentDirectory(environmentId: string, directory: string) {
  environmentsStore.update((state) => ({
    ...state,
    teamDirectories: { ...state.teamDirectories, [environmentId]: directory },
  }));
}
