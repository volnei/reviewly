import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import {
  Bell,
  Check,
  FolderGit2,
  GitPullRequest,
  Info,
  Palette,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { settingsCategoryStore, useSettingsCategory } from "@/app/settings-navigation";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { checkForUpdates } from "@/app/updater";
import { openWhatsNew } from "@/app/whats-new";
import { parseRepository, workspaceStore } from "@/app/workspace";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field as CossField, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { run, useEffectQuery } from "@/effect/runtime";
import { Ai, MODEL_SUGGESTIONS, providerName, PROVIDERS } from "@/effect/services/Ai";
import { AppSettings } from "@/effect/services/AppSettings";
import { Auth, useAuth } from "@/effect/services/Auth";
import { GitHub } from "@/effect/services/GitHub";
import { type Prefs, prefsStore, usePrefs } from "@/effect/services/Prefs";
import { isNative } from "@/effect/Tauri";
import { StackHopperArcade } from "@/features/arcade/stack-hopper";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  {
    id: "general",
    label: "General",
    description: "Startup, syncing and app behavior.",
    icon: SlidersHorizontal,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, interface scale and accessibility.",
    icon: Palette,
  },
  {
    id: "repositories",
    label: "Repositories",
    description: "Choose the repositories that belong in your workspace.",
    icon: FolderGit2,
  },
  {
    id: "review",
    label: "Reading & review",
    description: "Make the review experience work the way you do.",
    icon: GitPullRequest,
  },
  {
    id: "assistant",
    label: "AI assistant",
    description: "Your provider, model and review preferences.",
    icon: Sparkles,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Choose when Reviewly should get your attention.",
    icon: Bell,
  },
  {
    id: "account",
    label: "Account",
    description: "Your GitHub connection and activity.",
    icon: UserRound,
  },
  {
    id: "about",
    label: "About Reviewly",
    description: "Version, updates and release notes.",
    icon: Info,
  },
] as const;

/** Categorized preferences, with Coss controls and immediate updates. */
export function SettingsScreen() {
  useTitleSlot(<span className="text-[13px] text-ink-2">Settings</span>, "page");
  const category = useSettingsCategory();
  const qc = useQueryClient();
  const prefs = usePrefs();
  const auth = useAuth();
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    prefsStore.update((p) => ({ ...p, [key]: value }));

  return (
    <Tabs
      orientation="vertical"
      value={category}
      onValueChange={(value) => settingsCategoryStore.set(value as typeof category)}
      className="settings-v2 h-full gap-0 bg-page"
    >
      <aside className="settings-navigation">
        <div className="settings-nav-heading">
          <Settings2 size={15} />
          <span>Settings</span>
        </div>
        <TabsList
          variant="underline"
          aria-label="Settings categories"
          className="settings-nav-list"
        >
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <TabsTab key={id} value={id} className="settings-nav-item">
              <Icon size={15} aria-hidden />
              <span>{label}</span>
            </TabsTab>
          ))}
        </TabsList>
        <p className="settings-nav-note">
          Your workspace.
          <br />
          Your way of reviewing.
        </p>
      </aside>
      <div className="settings-panels">
        <TabsPanel value="general" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>General</h1>
                <span>Startup, syncing and app behavior.</span>
              </div>
            </header>
            <Section title="Behaviour">
              <Field label="Open on" hint="The screen the window starts on.">
                <Choice
                  inline
                  value={prefs.landing}
                  onChange={(v) => set("landing", v)}
                  options={[
                    { value: "inbox", label: "Inbox" },
                    { value: "home", label: "Home" },
                  ]}
                />
              </Field>
              <Field
                label="Look at GitHub every"
                hint="The poller runs in the background and tells the tray."
              >
                <Choice
                  inline
                  value={String(prefs.pollMinutes)}
                  onChange={(v) => {
                    set("pollMinutes", Number(v));
                    run(Effect.flatMap(AppSettings, (a) => a.setPollInterval(Number(v)))).catch(
                      (e) => toast.fail("Couldn’t change sync interval", e),
                    );
                  }}
                  options={[
                    { value: "1", label: "minute" },
                    { value: "2", label: "2 min" },
                    { value: "5", label: "5 min" },
                    { value: "15", label: "15 min" },
                  ]}
                />
              </Field>
              <Toggle
                label="Launch at login"
                checked={prefs.launchAtLogin}
                onChange={(v) => {
                  set("launchAtLogin", v);
                  run(Effect.flatMap(AppSettings, (a) => a.setLaunchAtLogin(v))).catch((e) =>
                    toast.fail("Couldn’t change launch at login", e),
                  );
                }}
              />
              <Toggle
                label="Start in the menu bar"
                hint="No window until you ask for one."
                checked={prefs.startInTray}
                onChange={(v) => {
                  set("startInTray", v);
                  run(Effect.flatMap(AppSettings, (a) => a.setStartInTray(v))).catch((e) =>
                    toast.fail("Couldn’t change startup behavior", e),
                  );
                }}
              />
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="appearance" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <Palette size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>Appearance</h1>
                <span>Theme, interface scale and accessibility.</span>
              </div>
            </header>
            <Section title="Appearance" blurb="Choose the atmosphere that fits your workspace.">
              <Field label="Theme">
                <Choice
                  inline
                  value={prefs.appearance}
                  onChange={(v) => set("appearance", v)}
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                    { value: "system", label: "System" },
                    { value: "sunset", label: "Sunset" },
                    { value: "stellarium", label: "Stellarium" },
                    { value: "aurora", label: "Aurora" },
                    { value: "nature", label: "Nature" },
                    { value: "nebula", label: "Nebula" },
                    { value: "clouds", label: "Clouds" },
                  ]}
                />
              </Field>
              {isNative() && /Mac/.test(navigator.platform) ? (
                <Field label="Dock icon">
                  <Choice
                    inline
                    value={prefs.appIcon}
                    onChange={(v) => set("appIcon", v)}
                    options={[
                      { value: "white", label: "White" },
                      { value: "black", label: "Black" },
                    ]}
                  />
                </Field>
              ) : null}
              <Field label="Size" hint="⌘= and ⌘- on any screen, ⌘0 to come back.">
                <Choice
                  inline
                  value={String(prefs.zoom)}
                  onChange={(v) => set("zoom", Number(v))}
                  options={[
                    { value: "0.9", label: "90%" },
                    { value: "1", label: "100%" },
                    { value: "1.1", label: "110%" },
                    { value: "1.25", label: "125%" },
                  ]}
                />
              </Field>
              <Toggle
                label="Reduce motion"
                checked={prefs.reduceMotion}
                onChange={(v) => set("reduceMotion", v)}
              />
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="repositories" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <FolderGit2 size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>Repositories</h1>
                <span>Choose the repositories that belong in your workspace.</span>
              </div>
            </header>
            <WatchedRepos
              repos={prefs.watchedRepos}
              onChange={async (repos) => {
                try {
                  await run(Effect.flatMap(AppSettings, (a) => a.setWatchedRepos(repos)));
                  set("watchedRepos", repos);
                  if (workspaceStore.get() && !repos.includes(workspaceStore.get() ?? ""))
                    workspaceStore.set(null);
                  void qc.invalidateQueries({ queryKey: ["inbox"] });
                  void qc.invalidateQueries({ queryKey: ["prs"] });
                } catch (e) {
                  toast.fail("Couldn’t update watched repositories", e);
                  throw e;
                }
              }}
            />
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="review" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <GitPullRequest size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>Reading & review</h1>
                <span>Make the review experience work the way you do.</span>
              </div>
            </header>
            <Section title="Reading" blurb="How a pull request opens.">
              <Toggle
                label="Split diff"
                hint="Old on the left, new on the right. ⌘B flips it on any PR."
                checked={prefs.splitDiff}
                onChange={(v) => set("splitDiff", v)}
              />
              <Toggle
                label="Comments beside the code"
                hint="Show comment threads beside the diff instead of below it."
                checked={prefs.threadsBeside}
                onChange={(v) => set("threadsBeside", v)}
              />
              <Toggle
                label="Mark files read as you scroll past them"
                hint="Mark a file as read when you reach its end. Press V to toggle it manually."
                checked={prefs.autoMarkRead}
                onChange={(v) => set("autoMarkRead", v)}
              />
              <Toggle
                label="Hide whitespace-only changes"
                hint="A reindent reads as unchanged. The diff says so where it folded one."
                checked={prefs.hideWhitespace}
                onChange={(v) => set("hideWhitespace", v)}
              />
              <Toggle
                label="Wrap long lines"
                hint="Off, a long line scrolls sideways inside its file."
                checked={prefs.wrapLines}
                onChange={(v) => set("wrapLines", v)}
              />
              <Toggle
                label="Fold generated files and lockfiles"
                hint="They stay in the list, under their own heading, closed until you open one. Format-only and comment-only changes fold with them."
                checked={prefs.hideNoise}
                onChange={(v) => set("hideNoise", v)}
              />
              <Toggle
                label="Ask before a review goes up"
                hint="One more step between the button and GitHub."
                checked={prefs.confirmBeforeSubmit}
                onChange={(v) => set("confirmBeforeSubmit", v)}
              />
              <Toggle
                label="A review on a draft marks it ready"
                hint="Sending a review on a draft pull request takes it out of draft. The toast has a way back."
                checked={prefs.autoReadyOnReview}
                onChange={(v) => set("autoReadyOnReview", v)}
              />
              <Field label="Files, in this order">
                <Choice
                  value={prefs.filesOrder}
                  onChange={(v) => set("filesOrder", v)}
                  inline
                  options={[
                    { value: "path", label: "By path" },
                    { value: "layer", label: "By layer" },
                    { value: "guided", label: "Guided" },
                  ]}
                />
              </Field>
            </Section>

            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="assistant" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <Sparkles size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>AI assistant</h1>
                <span>Your provider, model and review preferences.</span>
              </div>
            </header>
            <Section
              title="Review assistant"
              blurb="A CLI on this machine or an OpenAI-compatible endpoint, used only when you ask on a PR. The prompt and the diff go to the provider you pick; nothing else does."
            >
              <Field label="Provider">
                <Choice
                  inline
                  value={prefs.ai.provider}
                  onChange={(v) => set("ai", { ...prefs.ai, provider: v })}
                  options={PROVIDERS.map(([value, label]) => ({ value, label }))}
                />
                <ProviderStatus provider={prefs.ai.provider} ai={prefs.ai} />
              </Field>
              <Field
                label="Model"
                hint={
                  prefs.ai.provider === "openai"
                    ? "The model id the endpoint expects."
                    : "Leave empty for the CLI’s own default."
                }
              >
                <Autocomplete
                  items={MODEL_SUGGESTIONS[prefs.ai.provider]}
                  value={prefs.ai.model}
                  onValueChange={(value) => set("ai", { ...prefs.ai, model: value })}
                >
                  <AutocompleteInput
                    size="sm"
                    placeholder={
                      prefs.ai.provider === "openai" ? "e.g. llama3.1" : "Provider default"
                    }
                    aria-label="AI model"
                  />
                  <AutocompletePopup>
                    <AutocompleteList>
                      {(model: string) => (
                        <AutocompleteItem key={model} value={model}>
                          {model}
                        </AutocompleteItem>
                      )}
                    </AutocompleteList>
                  </AutocompletePopup>
                </Autocomplete>
              </Field>
              {prefs.ai.provider === "openai" ? (
                <>
                  <Field label="Quick setup" hint="Fills the URL, and the model when it is empty.">
                    <div className="flex flex-wrap gap-1.5">
                      {OPENAI_PRESETS.map((p) => (
                        <Button
                          key={p.label}
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            set("ai", {
                              ...prefs.ai,
                              baseUrl: p.baseUrl,
                              model: prefs.ai.model || p.model,
                            })
                          }
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field
                    label="Base URL"
                    hint="Ollama, LM Studio, OpenRouter, Groq — anything that speaks the OpenAI API."
                  >
                    <Input
                      size="sm"
                      value={prefs.ai.baseUrl}
                      onChange={(e) => set("ai", { ...prefs.ai, baseUrl: e.target.value })}
                      placeholder="http://localhost:11434/v1"
                    />
                  </Field>
                  <Field label="API key" hint="Local servers need none.">
                    <Input
                      size="sm"
                      type="password"
                      value={prefs.ai.apiKey}
                      onChange={(e) => set("ai", { ...prefs.ai, apiKey: e.target.value })}
                      autoComplete="off"
                    />
                  </Field>
                </>
              ) : null}
              <Field
                label="Stop after no activity"
                hint="Streaming Claude and Codex runs keep going while they report progress. Auto allows 3 minutes of silence, or 15 while reading a local repository."
              >
                <Choice
                  inline
                  value={String(prefs.ai.timeoutSecs)}
                  onChange={(v) => set("ai", { ...prefs.ai, timeoutSecs: Number(v) })}
                  options={[
                    { value: "0", label: "auto" },
                    { value: "120", label: "2 min" },
                    { value: "300", label: "5 min" },
                    { value: "600", label: "10 min" },
                  ]}
                />
              </Field>
              <Toggle
                label="Start the tour when a pull request opens"
                hint="Once per pull request, when the provider answers from this machine."
                checked={prefs.ai.autoTour}
                onChange={(v) => set("ai", { ...prefs.ai, autoTour: v })}
              />
              <Toggle
                label="Read ahead"
                hint="The first pull requests of the Inbox get one paragraph from the model in the background, one at a time. A peek (space) shows it."
                checked={prefs.ai.preread}
                onChange={(v) => set("ai", { ...prefs.ai, preread: v })}
              />
              <CossField className="settings-instructions">
                <div className="settings-instructions-heading">
                  <div>
                    <FieldLabel>Review instructions</FieldLabel>
                    <FieldDescription>
                      The standards the assistant should follow in every review.
                    </FieldDescription>
                  </div>
                  <span>Markdown supported</span>
                </div>
                <Textarea
                  value={prefs.ai.instructions}
                  onChange={(e) => set("ai", { ...prefs.ai, instructions: e.target.value })}
                  rows={5}
                  placeholder={
                    "- Migrations must be reversible.\n- Document public API changes.\n- Flag missing tests for critical paths."
                  }
                  className="settings-instructions-editor"
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <div className="settings-instructions-meta">
                  <span>Added once to every AI review</span>
                  <span>
                    {prefs.ai.instructions.trim()
                      ? `${prefs.ai.instructions.length} characters`
                      : "No custom instructions"}
                  </span>
                </div>
              </CossField>
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="notifications" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <Bell size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>Notifications</h1>
                <span>Choose when Reviewly should get your attention.</span>
              </div>
            </header>
            <Section title="Notifications">
              <Toggle
                label="Notify me"
                hint="A system notification when something new needs you."
                checked={prefs.notifications.enabled}
                onChange={(v) => {
                  set("notifications", { ...prefs.notifications, enabled: v });
                  run(Effect.flatMap(AppSettings, (a) => a.setNotificationsEnabled(v))).catch((e) =>
                    toast.fail("Couldn’t update notifications", e),
                  );
                }}
              />
              {prefs.notifications.enabled ? (
                <div className="mt-2 grid gap-2">
                  {[
                    ["review_requested", "A review is requested"],
                    ["mention", "Someone mentions me"],
                    ["comment", "A new comment where I took part"],
                    ["ci_activity", "Checks finish on my pull request"],
                  ].map(([reason, label]) => {
                    const on = prefs.notifications.reasons.includes(reason);
                    return (
                      <Label
                        key={reason}
                        className="flex items-center gap-2 text-[13px] text-ink-2"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(checked) => {
                            const reasons = checked
                              ? [...prefs.notifications.reasons, reason]
                              : prefs.notifications.reasons.filter((r) => r !== reason);
                            set("notifications", { ...prefs.notifications, reasons });
                            run(
                              Effect.flatMap(AppSettings, (a) => a.setNotificationReasons(reasons)),
                            ).catch((e) => toast.fail("Couldn’t update notification reasons", e));
                          }}
                        />
                        {label}
                      </Label>
                    );
                  })}
                </div>
              ) : null}
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="account" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <UserRound size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>Account</h1>
                <span>Your GitHub connection and activity.</span>
              </div>
            </header>
            <Section
              title="Account"
              blurb="Reviewly reads GitHub as you. Nothing is stored anywhere but this machine."
            >
              {auth.viewer ? (
                <div className="flex items-center gap-3">
                  <img
                    src={auth.viewer.avatar_url}
                    alt=""
                    className="size-8 rounded-full bg-raise"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{auth.viewer.name ?? auth.viewer.login}</p>
                    <p className="text-[12.5px] text-ink-3">
                      @{auth.viewer.login}
                      <ActivityChips login={auth.viewer.login} />
                    </p>
                    <p className="mt-0.5 font-mono text-[11.5px] text-ink-3">{auth.host}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      run(Effect.flatMap(Auth, (a) => a.signOut)).catch((e) =>
                        toast.fail("Couldn’t sign out", e),
                      )
                    }
                  >
                    Sign out
                  </Button>
                </div>
              ) : null}
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
        <TabsPanel value="about" keepMounted className="settings-panel">
          <div className="settings-page">
            <header className="settings-page-header">
              <div className="settings-page-icon">
                <Info size={18} />
              </div>
              <div>
                <p>Preferences</p>
                <h1>About Reviewly</h1>
                <span>Version, updates and release notes.</span>
              </div>
            </header>
            <Section title="About">
              <About />
            </Section>
            <Section title="Arcade" blurb="A small offline break, hidden in plain sight.">
              <StackHopperArcade />
            </Section>
            <p className="settings-autosave">
              <Check size={12} />
              Changes apply automatically.
            </p>
          </div>
        </TabsPanel>
      </div>
    </Tabs>
  );
}

/** The version, the source, the updater, and the release notes. */
function About() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isNative()) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => {});
  }, []);
  return (
    <div className="grid gap-3 text-[13px]">
      <p className="text-ink-2">
        Reviewly{version ? <span className="tnum"> {version}</span> : null}. A desk for reviewing
        pull requests, with the model you choose and nothing leaving the machine unless you say so.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void checkForUpdates()}>
          Check for updates
        </Button>
        <Button variant="ghost" size="sm" onClick={openWhatsNew}>
          What’s new
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => safeOpenUrl("https://github.com/volnei/reviewly")}
        >
          Source on GitHub
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <Card className="settings-card">
      <div className="settings-card-heading">
        <h2>{title}</h2>
        {blurb ? <p>{blurb}</p> : null}
      </div>
      <div className="settings-card-body">{children}</div>
    </Card>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <CossField className="settings-field">
      <div className="settings-field-copy">
        <FieldLabel>{label}</FieldLabel>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </div>
      <div className="settings-field-control">{children}</div>
    </CossField>
  );
}
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <CossField className="settings-toggle">
      <div className="settings-field-copy">
        <FieldLabel>{label}</FieldLabel>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </CossField>
  );
}
function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  inline?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div className="settings-choice">
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== null) onChange(v);
        }}
      >
        <SelectTrigger size="sm">
          <SelectValue>{selected?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {selected?.hint ? <p className="settings-choice-hint">{selected.hint}</p> : null}
    </div>
  );
}

function WatchedRepos({
  repos,
  onChange,
}: {
  repos: ReadonlyArray<string>;
  onChange: (r: string[]) => Promise<void>;
}) {
  const all = useEffectQuery(
    ["repos"],
    Effect.flatMap(GitHub, (g) => g.repos),
  );
  const [draft, setDraft] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const candidates = (all.data ?? []).filter(
    (r) => !repos.some((watched) => watched.toLowerCase() === r.toLowerCase()),
  );
  const slug = parseRepository(draft);
  const duplicate = !!slug && repos.some((r) => r.toLowerCase() === slug.toLowerCase());
  const change = async (next: string[], clear = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await onChange(next);
      if (clear) setDraft("");
    } catch {
      /* The parent reports the failed backend update. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Watched repositories"
      blurb="Pull requests from these repositories appear in your workspace."
    >
      <div className="settings-repo-list">
        {repos.map((repo) => (
          <div key={repo} className="settings-repo-row">
            <FolderGit2 size={16} className="text-ink-3" />
            <div>
              <span>{repo.split("/").pop()}</span>
              <small>{repo}</small>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              aria-label={`Stop watching ${repo}`}
              onClick={() => void change(repos.filter((r) => r !== repo))}
            >
              <X size={13} />
            </Button>
          </div>
        ))}
        {!repos.length ? (
          <p className="text-[12px] text-ink-3">No repositories watched yet. Add one below.</p>
        ) : null}
      </div>
      <form
        className="settings-repo-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (slug && !duplicate) void change([...repos, slug], true);
        }}
      >
        <Input
          size="sm"
          aria-label="Repository name or URL"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="owner/repository or GitHub URL"
          className="min-w-0 flex-1"
        />
        <Button variant="outline" size="sm" type="submit" disabled={busy || !slug || duplicate}>
          {busy ? "Updating…" : "Add repository"}
        </Button>
        {duplicate ? (
          <p className="w-full text-[11px] text-ink-3">This repository is already watched.</p>
        ) : null}
      </form>
      {candidates.length ? (
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMore((m) => !m)}>
            {more ? "Hide suggestions" : `Browse ${candidates.length} available repositories`}
          </Button>
          {more ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((repo) => (
                <Button
                  key={repo}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void change([...repos, repo])}
                >
                  {repo}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {all.isError ? (
        <p className="text-[11px] text-ink-3">
          Repository suggestions are unavailable. You can still add a repository by name.
        </p>
      ) : null}
    </Section>
  );
}

const OPENAI_PRESETS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
];
const INSTALL: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  gemini: "npm i -g @google/gemini-cli",
};

/** Whether the provider answers from this machine, asked when it is picked. */
function ProviderStatus({ provider, ai }: { provider: string; ai: Prefs["ai"] }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (provider === "openai") return;
    let on = true;
    setOk(null);
    run(Effect.flatMap(Ai, (a) => a.available(provider)))
      .then((v) => on && setOk(v))
      .catch(() => on && setOk(false));
    return () => {
      on = false;
    };
  }, [provider]);
  if (provider === "openai")
    return (
      <p className="mt-2 text-[12px] text-ink-3">
        {ai.baseUrl && ai.model
          ? `Configured: ${ai.model} at ${ai.baseUrl}.`
          : "Needs a base URL and a model."}
      </p>
    );
  return (
    <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
      <span
        className={cn(
          "size-1.5 rounded-full",
          ok === null ? "animate-pulse bg-ink-3" : ok ? "bg-add" : "bg-del",
        )}
        aria-hidden
      />
      {ok === null
        ? "Checking…"
        : ok
          ? `${providerName(provider)} answers from this machine.`
          : "Not found on this machine. Install it: "}
      {ok === false ? (
        <code className="mono selectable text-ink-2">{INSTALL[provider]}</code>
      ) : null}
    </p>
  );
}

/** Your year on GitHub in two numbers. */
function ActivityChips({ login }: { login: string }) {
  const activity = useEffectQuery(
    ["activity", login],
    Effect.flatMap(GitHub, (g) => g.activity(login)),
    { staleTime: 3_600_000 },
  );
  if (!activity.data) return null;
  return (
    <span className="tnum ml-2 text-ink-3">
      · <span className="text-ink-2">{activity.data.commits}</span> commits ·{" "}
      <span className="text-ink-2">{activity.data.mergedPrs}</span> merged this year
    </span>
  );
}
