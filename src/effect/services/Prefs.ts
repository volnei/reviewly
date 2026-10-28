import { persistedStore, useStore } from "@/effect/store";
import { APP_STORE } from "@/lib/edition";
import { Context, Effect, Layer, Schema } from "effect";

/**
 * Everything the user has decided, in one typed record, persisted on the
 * machine. React reads it through `usePrefs`; effects through the service.
 */
export const Verdict = Schema.Literals([
  "risky",
  "yours",
  "routine",
  "mergeable",
  "waiting",
  "unsorted",
]);
export type Verdict = typeof Verdict.Type;

export const Prefs = Schema.Struct({
  watchedRepos: Schema.Array(Schema.String),
  pollMinutes: Schema.Number,
  ranking: Schema.Struct({
    provider: Schema.Literals(["rules", "hosted"]),
    hostedKey: Schema.String,
    /** Below this confidence the hosted model's answer lands in "Couldn’t rank these". */
    minConfidence: Schema.Number,
  }),
  /** item id → ISO date it comes back. */
  snoozed: Schema.Record(Schema.String, Schema.String),
  /** item ids marked done by hand (`e`). */
  done: Schema.Array(Schema.String),
  /** item ids of reviews sent today, for the streak. */
  reviewed: Schema.Array(Schema.String),
  splitDiff: Schema.Boolean,
  threadsBeside: Schema.Boolean,
  filesOrder: Schema.Literals(["path", "layer", "guided"]),
  /** A file counts as read once its end has been on screen. */
  autoMarkRead: Schema.Boolean,
  hideWhitespace: Schema.Boolean,
  wrapLines: Schema.Boolean,
  /** Lockfiles, snapshots, generated code: folded in the files column. */
  hideNoise: Schema.Boolean,
  reduceMotion: Schema.Boolean,
  notifications: Schema.Struct({ enabled: Schema.Boolean, reasons: Schema.Array(Schema.String) }),
  launchAtLogin: Schema.Boolean,
  startInTray: Schema.Boolean,
  ai: Schema.Struct({
    provider: Schema.Literals(["claude", "codex", "gemini", "openai"]),
    model: Schema.String,
    apiKey: Schema.String,
    baseUrl: Schema.String,
    /** 0 = the backend's own default (3 minutes, 7 with a local clone). */
    timeoutSecs: Schema.Number,
    /** Prepended to every prompt: the team's review standards, once. */
    instructions: Schema.String,
    /** Summarise the top of the Inbox in the background, so a peek is already read. */
    preread: Schema.Boolean,
    /** Start the guided tour the moment a PR opens. */
    autoTour: Schema.Boolean,
    /** Where a stop's suggested comment goes first: into your review, or straight to GitHub. */
    suggestionAction: Schema.Literals(["draft", "post"]),
  }),
  /** Sending a review on a draft PR marks it ready for review. */
  autoReadyOnReview: Schema.Boolean,
  /** One more step before a review goes up. */
  confirmBeforeSubmit: Schema.Boolean,
  /** The Dock icon, on macOS. */
  appIcon: Schema.Literals(["white", "black"]),
  /** The screen the window opens on. */
  landing: Schema.Literals(["inbox", "home"]),
  /** The editor you opened last; the one the menu offers first. */
  editorTarget: Schema.String,
  localRepos: Schema.Array(Schema.String),
  /** How you merge, remembered: pre-selected for Merge and auto-merge. */
  mergeMethod: Schema.Literals(["merge", "squash", "rebase"]),
  appearance: Schema.Literals([
    "dark",
    "light",
    "system",
    "sunset",
    "stellarium",
    "aurora",
    "nature",
    "nebula",
    "clouds",
  ]),
  /** Webview zoom factor; 1 is the design size. */
  zoom: Schema.Number,
  /** The version whose release notes you have seen. */
  lastSeenVersion: Schema.String,
  /** Column widths you dragged, in px. */
  filesWidth: Schema.Number,
  askWidth: Schema.Number,
});
export type Prefs = typeof Prefs.Type;

const defaultPrefs: Prefs = {
  watchedRepos: [],
  pollMinutes: 2,
  ranking: { provider: "rules", hostedKey: "", minConfidence: 0.6 },
  snoozed: {},
  done: [],
  reviewed: [],
  splitDiff: false,
  threadsBeside: false,
  filesOrder: "path",
  autoMarkRead: true,
  hideWhitespace: false,
  wrapLines: true,
  hideNoise: true,
  reduceMotion: false,
  notifications: { enabled: true, reasons: ["review_requested", "mention"] },
  launchAtLogin: false,
  startInTray: false,
  ai: {
    provider: APP_STORE ? "openai" : "claude",
    model: "",
    apiKey: "",
    baseUrl: "",
    timeoutSecs: 0,
    instructions: "",
    preread: true,
    autoTour: false,
    suggestionAction: "draft",
  },
  autoReadyOnReview: false,
  confirmBeforeSubmit: false,
  appIcon: "white",
  landing: "inbox",
  editorTarget: "",
  localRepos: [],
  mergeMethod: "squash",
  appearance: "dark",
  zoom: 1,
  lastSeenVersion: "",
  filesWidth: 256,
  askWidth: 400,
};

const KEY = "reviewly.v2.prefs";
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Decode key by key: one stale field falls back to its default, the rest survives; nested records gain new keys from the defaults. */
function decode(raw: unknown): Prefs {
  if (!isRecord(raw)) return defaultPrefs;
  const out: Record<string, unknown> = { ...defaultPrefs };
  for (const k of Object.keys(defaultPrefs) as Array<keyof Prefs>) {
    if (!(k in raw)) continue;
    const stored = raw[k];
    const fallback = defaultPrefs[k];
    const candidate = isRecord(fallback) && isRecord(stored) ? { ...fallback, ...stored } : stored;
    try {
      out[k] = Schema.decodeUnknownSync(Prefs.fields[k])(candidate);
    } catch {
      /* keep the default */
    }
  }
  // The sandbox can't run the AI CLIs or read repo folders, so a value carried
  // over from the direct build never survives into the App Store edition.
  if (APP_STORE) {
    out.ai = { ...(out.ai as Prefs["ai"]), provider: "openai" };
    out.localRepos = [];
    out.launchAtLogin = false;
  }
  return out as Prefs;
}

export const prefsStore = persistedStore<Prefs>(KEY, defaultPrefs, decode);

export function usePrefs(): Prefs;
export function usePrefs<T>(select: (p: Prefs) => T): T;
export function usePrefs<T>(select?: (p: Prefs) => T) {
  const prefs = useStore(prefsStore);
  return select ? select(prefs) : prefs;
}

export class PrefsService extends Context.Service<
  PrefsService,
  {
    readonly get: Effect.Effect<Prefs>;
    readonly update: (f: (p: Prefs) => Prefs) => Effect.Effect<Prefs>;
  }
>()("reviewly/Prefs") {}

export const PrefsLive = Layer.succeed(PrefsService, {
  get: Effect.sync(() => prefsStore.get()),
  update: (f) =>
    Effect.sync(() => {
      prefsStore.update(f);
      return prefsStore.get();
    }),
});

/** Snoozed until a date still in the future? */
export function isSnoozed(p: Prefs, id: string, now = Date.now()): boolean {
  const until = p.snoozed[id];
  return !!until && Date.parse(until) > now;
}

/** Tomorrow morning, local time — the one snooze the list offers by key. */
export function tomorrowMorning(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
