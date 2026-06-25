import { Card } from "@/components/card";
import { CollapsibleSection } from "@/components/collapsible-section";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserHoverCard } from "@/components/user-hover-card";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { type AiProvider, CLI_PROVIDERS, useAiProvider } from "@/stores/ai";
import { LANDING_OPTIONS, useAppBehavior } from "@/stores/app-behavior";
import { ACCENTS, useAppearance } from "@/stores/appearance";
import { useAuth } from "@/stores/auth";
import { useNotifSettings } from "@/stores/notif-settings";
import { useReviewPrefs } from "@/stores/review-prefs";
import { useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  Compass,
  Eye,
  Github,
  Lock,
  LogOut,
  type LucideIcon,
  Palette,
  RotateCcw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function SettingsPage() {
  const viewer = useAuth((s) => s.viewer);
  const setAuth = useAuth((s) => s.set);
  const qc = useQueryClient();
  const provider = useAiProvider((s) => s.provider);
  const setProvider = useAiProvider((s) => s.setProvider);
  const openaiConfigured = useAiProvider(
    (s) => s.baseUrl.trim().length > 0 && s.model.trim().length > 0,
  );
  const [available, setAvailable] = useState<Partial<Record<AiProvider, boolean | null>>>({});

  useEffect(() => {
    for (const p of CLI_PROVIDERS) {
      invoke<boolean>("ai_available", { provider: p })
        .then((v) => setAvailable((prev) => ({ ...prev, [p]: v })))
        .catch(() => setAvailable((prev) => ({ ...prev, [p]: false })));
    }
  }, []);

  async function signOut() {
    await invoke("auth_sign_out");
    setAuth({ signedIn: false, viewer: null, loading: false });
    qc.clear();
    toast.success("Signed out");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" subtitle="Account and AI review" />

      <ScrollArea className="flex-1">
        <div className="space-y-5 px-6 py-5">
          <CollapsibleSection id="github" title="GitHub account" icon={Github}>
            {viewer ? (
              <Card className="flex items-center gap-3">
                <UserHoverCard user={viewer}>
                  <img src={viewer.avatar_url} alt={viewer.login} className="size-9 rounded-full" />
                </UserHoverCard>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{viewer.name ?? viewer.login}</p>
                  <p className="text-xs text-muted-foreground">@{viewer.login}</p>
                </div>
                <Button variant="destructive-outline" size="sm" onClick={signOut}>
                  <LogOut className="size-3.5" />
                  Sign out
                </Button>
              </Card>
            ) : (
              <Card className="text-xs text-muted-foreground">Not signed in.</Card>
            )}
          </CollapsibleSection>

          <CollapsibleSection id="ai" title="AI review" icon={Sparkles}>
            <Card>
              {/* Lead with the local-first promise — it's the whole point. */}
              <div className="flex items-start gap-2.5 rounded-xl bg-foreground/[0.03] px-3 py-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Runs on your machine.</span>{" "}
                  Reviewly drives a local AI CLI — or your own endpoint — so reviews happen on your
                  computer. Only the PR diff is sent to the backend you pick; there's no reviewly
                  server in the middle.
                </p>
              </div>

              <p className="mt-3 mb-2 text-[11px] font-medium text-muted-foreground">Backend</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <ProviderCard
                    key={p.id}
                    meta={p}
                    selected={provider === p.id}
                    onSelect={() => setProvider(p.id)}
                    status={
                      p.http
                        ? openaiConfigured
                          ? "configured"
                          : "config"
                        : (available[p.id] ?? null)
                    }
                  />
                ))}
              </div>

              {provider === "openai" && <OpenAiConfig />}

              <AiInstructions />
            </Card>
          </CollapsibleSection>

          <AppearanceSection />
          <CodeReviewSection />
          <GuidedTourSection />
          <NotificationsSection />
          <BehaviorSection />
        </div>
      </ScrollArea>
    </div>
  );
}

/** Max instruction length — keeps the prompt prefix bounded and the count useful. */
const AI_INSTRUCTIONS_MAX = 2000;

/**
 * AI review-instructions field. Edits live in local state and autosave to the
 * persisted store after a short debounce, with a "Saving…/Saved" indicator (79)
 * plus a char count and a Reset affordance (80).
 */
function AiInstructions() {
  const stored = useReviewPrefs((s) => s.aiInstructions);
  const setAiInstructions = useReviewPrefs((s) => s.setAiInstructions);
  const [value, setValue] = useState(stored);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: string) {
    setValue(next);
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    saveTimer.current = setTimeout(() => {
      setAiInstructions(next);
      setStatus("saved");
      savedTimer.current = setTimeout(() => setStatus("idle"), 2000);
    }, 600);
  }

  // Clear timers on unmount so a pending save/indicator can't fire afterwards.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function reset() {
    if (!value) return;
    if (!window.confirm("Clear your review instructions?")) return;
    commit("");
  }

  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Review instructions</p>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {status === "saving" ? (
            "Saving…"
          ) : status === "saved" ? (
            <>
              <Check className="size-3 text-success" />
              Saved
            </>
          ) : null}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Your review style + house rules, sent with every AI review and chat. e.g. “Be terse. Flag
        missing tests and error handling. Prefer composition over inheritance.”
      </p>
      <Textarea
        value={value}
        onChange={(e) => commit(e.target.value.slice(0, AI_INSTRUCTIONS_MAX))}
        placeholder="Describe how you want the AI to review…"
        rows={5}
        spellCheck={false}
        maxLength={AI_INSTRUCTIONS_MAX}
        className="mt-2 w-full resize-none font-sans text-xs"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {value.length} / {AI_INSTRUCTIONS_MAX}
        </span>
        {value.length > 0 && (
          <Button variant="ghost" size="xs" onClick={reset}>
            <RotateCcw className="size-3" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

function AppearanceSection() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const accent = useAppearance((s) => s.accent);
  const setAccent = useAppearance((s) => s.setAccent);
  const reduceMotion = useAppearance((s) => s.reduceMotion);
  const setReduceMotion = useAppearance((s) => s.setReduceMotion);
  return (
    <CollapsibleSection id="appearance" title="Appearance" icon={Palette}>
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Theme</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Match your system, or force light / dark.
            </p>
          </div>
          <Segmented
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={theme}
            onChange={setTheme}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Accent color</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Drives highlights, buttons, and the active state across the app.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {ACCENTS.map((a) => {
              const on = accent === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccent(a.id)}
                  aria-label={a.label}
                  aria-pressed={on}
                  title={a.label}
                  className="size-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: a.swatch,
                    boxShadow: on
                      ? `0 0 0 2px var(--color-background), 0 0 0 3.5px ${a.swatch}`
                      : undefined,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="border-t border-hairline pt-4">
          <SettingToggle
            label="Reduce motion"
            description="Turn off animations and transitions across the app."
            checked={reduceMotion}
            onChange={setReduceMotion}
          />
        </div>
      </Card>
    </CollapsibleSection>
  );
}

function CodeReviewSection() {
  const autoMarkViewed = useReviewPrefs((s) => s.autoMarkViewed);
  const setAutoMarkViewed = useReviewPrefs((s) => s.setAutoMarkViewed);
  const autoReadyOnReview = useReviewPrefs((s) => s.autoReadyOnReview);
  const setAutoReadyOnReview = useReviewPrefs((s) => s.setAutoReadyOnReview);
  const diffDensity = useReviewPrefs((s) => s.diffDensity);
  const setDiffDensity = useReviewPrefs((s) => s.setDiffDensity);
  const diffWrap = useReviewPrefs((s) => s.diffWrap);
  const setDiffWrap = useReviewPrefs((s) => s.setDiffWrap);
  const hideWhitespace = useReviewPrefs((s) => s.hideWhitespace);
  const setHideWhitespace = useReviewPrefs((s) => s.setHideWhitespace);
  const diffView = useUi((s) => s.diffView);
  const setDiffView = useUi((s) => s.setDiffView);
  const focusMode = useUi((s) => s.focusMode);
  const setFocusMode = useUi((s) => s.setFocusMode);
  return (
    <CollapsibleSection id="code-review" title="Code review" icon={Eye}>
      <Card className="space-y-4">
        <SettingToggle
          label="Hide generated & lockfile noise"
          description="Keep lockfiles, snapshots, and generated files out of the file list by default (Focus mode)."
          checked={focusMode}
          onChange={setFocusMode}
        />
        <SettingToggle
          label="Auto-mark files as viewed"
          description="When you scroll past the end of a file's diff, mark it viewed automatically."
          checked={autoMarkViewed}
          onChange={setAutoMarkViewed}
        />
        <SettingToggle
          label="Auto-mark ready on review"
          description="Flip a draft PR to ready-for-review when you submit a review."
          checked={autoReadyOnReview}
          onChange={setAutoReadyOnReview}
        />

        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Default diff view</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How diffs open — side-by-side or inline.
            </p>
          </div>
          <Segmented
            options={[
              { value: "unified", label: "Unified" },
              { value: "split", label: "Split" },
            ]}
            value={diffView === "split" ? "split" : "unified"}
            onChange={setDiffView}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Diff density</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Line spacing in the diff viewer.</p>
          </div>
          <Segmented
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
            value={diffDensity}
            onChange={setDiffDensity}
          />
        </div>

        <div className="border-t border-hairline pt-4">
          <SettingToggle
            label="Wrap long lines"
            description="Wrap long diff lines instead of scrolling them horizontally."
            checked={diffWrap}
            onChange={setDiffWrap}
          />
        </div>
        <SettingToggle
          label="Hide whitespace-only changes"
          description="Collapse lines that differ only by whitespace when reading a diff."
          checked={hideWhitespace}
          onChange={setHideWhitespace}
        />
      </Card>
    </CollapsibleSection>
  );
}

function GuidedTourSection() {
  const autoStartTour = useReviewPrefs((s) => s.autoStartTour);
  const setAutoStartTour = useReviewPrefs((s) => s.setAutoStartTour);
  const defaultSuggestionAction = useReviewPrefs((s) => s.defaultSuggestionAction);
  const setDefaultSuggestionAction = useReviewPrefs((s) => s.setDefaultSuggestionAction);
  return (
    <CollapsibleSection id="guided-tour" title="Guided tour" icon={Compass}>
      <Card className="space-y-4">
        <SettingToggle
          label="Auto-start the tour"
          description="Kick off the AI guided tour automatically when you open a PR. Uses your local AI each time."
          checked={autoStartTour}
          onChange={setAutoStartTour}
        />
        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Suggested-comment action</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The primary button on a tour's suggested comment.
            </p>
          </div>
          <Segmented
            options={[
              { value: "add", label: "Add to review" },
              { value: "post", label: "Post to GitHub" },
            ]}
            value={defaultSuggestionAction}
            onChange={setDefaultSuggestionAction}
          />
        </div>
      </Card>
    </CollapsibleSection>
  );
}

function BehaviorSection() {
  const confirmBeforeSubmit = useAppBehavior((s) => s.confirmBeforeSubmit);
  const setConfirmBeforeSubmit = useAppBehavior((s) => s.setConfirmBeforeSubmit);
  const defaultLandingPage = useAppBehavior((s) => s.defaultLandingPage);
  const setDefaultLandingPage = useAppBehavior((s) => s.setDefaultLandingPage);
  return (
    <CollapsibleSection id="behavior" title="Behavior" icon={SlidersHorizontal}>
      <Card className="space-y-4">
        <SettingToggle
          label="Confirm before submitting a review"
          description="Show a confirmation step before a review is posted to GitHub."
          checked={confirmBeforeSubmit}
          onChange={setConfirmBeforeSubmit}
        />
        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Default landing page</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Where the app opens on launch.</p>
          </div>
          <Select
            value={defaultLandingPage}
            onValueChange={(v) =>
              v && setDefaultLandingPage(v as (typeof LANDING_OPTIONS)[number]["value"])
            }
          >
            <SelectTrigger size="sm" className="w-44 text-xs text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANDING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
    </CollapsibleSection>
  );
}

function NotificationsSection() {
  const desktopEnabled = useNotifSettings((s) => s.desktopEnabled);
  const setDesktopEnabled = useNotifSettings((s) => s.setDesktopEnabled);
  return (
    <CollapsibleSection id="notifications" title="Notifications" icon={Bell}>
      <Card>
        <SettingToggle
          label="Desktop notifications"
          description="Get an OS alert when a pull request requests your review. Asks for notification permission the first time it's on."
          checked={desktopEnabled}
          onChange={setDesktopEnabled}
        />
      </Card>
    </CollapsibleSection>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="-mx-2 flex items-center justify-between gap-4 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/[0.03]">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/24",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

interface ProviderMeta {
  id: AiProvider;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /** Brand-ish glyph tint + tile background. */
  tint: string;
  tile: string;
  /** Local CLI install hint (CLI providers only). */
  install?: string;
  /** The HTTP OpenAI-compatible backend — configured, not installed. */
  http?: boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude",
    blurb: "Anthropic CLI · your Claude plan",
    icon: Sparkles,
    tint: "text-[#d97757]",
    tile: "bg-[#d97757]/12",
    install: "npm i -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    label: "Codex",
    blurb: "OpenAI CLI · your ChatGPT plan",
    icon: SquareTerminal,
    tint: "text-[#10a37f]",
    tile: "bg-[#10a37f]/12",
    install: "npm i -g @openai/codex",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    blurb: "Google · generous free tier",
    icon: Star,
    tint: "text-[#4285f4]",
    tile: "bg-[#4285f4]/12",
    install: "npm i -g @google/gemini-cli",
  },
  {
    id: "openai",
    label: "OpenAI-compatible",
    blurb: "Ollama · OpenRouter · DeepSeek",
    icon: Server,
    tint: "text-primary",
    tile: "bg-primary/12",
    http: true,
  },
];

type CardStatus = boolean | null | "configured" | "config";

/** A selectable backend card: brand glyph, one-line blurb, live status, and a
 * "runs locally" lock for the CLI providers. */
function ProviderCard({
  meta,
  status,
  selected,
  onSelect,
}: {
  meta: ProviderMeta;
  status: CardStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  const notFound = status === false;
  return (
    <button
      type="button"
      disabled={notFound}
      onClick={onSelect}
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
          : notFound
            ? "cursor-not-allowed border-hairline opacity-55"
            : "border-hairline hover:border-border hover:bg-foreground/[0.02]",
      )}
    >
      <span
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", meta.tile)}
      >
        <Icon className={cn("size-[18px]", meta.tint)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{meta.label}</span>
          {!meta.http && (
            <Lock className="size-3 shrink-0 text-muted-foreground/45" aria-label="Runs locally" />
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {meta.blurb}
        </span>
        <ProviderStatus status={status} install={meta.install} />
      </span>
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-primary bg-primary" : "border-border",
        )}
      >
        {selected && <Check className="size-2.5 text-primary-foreground" />}
      </span>
    </button>
  );
}

function ProviderStatus({ status, install }: { status: CardStatus; install?: string }) {
  if (status === null)
    return <span className="mt-1 block text-[11px] text-muted-foreground/60">checking…</span>;
  if (status === true || status === "configured")
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-success">
        <span className="size-1.5 rounded-full bg-success" />
        {status === "configured" ? "configured" : "available"}
      </span>
    );
  if (status === "config")
    return (
      <span className="mt-1 block text-[11px] text-muted-foreground/70">needs a base URL</span>
    );
  return (
    <span className="mt-1 block text-[11px] text-warning">
      not installed ·{" "}
      <code className="rounded bg-foreground/[0.08] px-1 font-mono text-[10px] text-muted-foreground">
        {install}
      </code>
    </span>
  );
}

/** Base URL / model / key config for the OpenAI-compatible backend, shown when
 * it's the selected card. One-click presets for Ollama, OpenRouter, DeepSeek. */
function OpenAiConfig() {
  const baseUrl = useAiProvider((s) => s.baseUrl);
  const model = useAiProvider((s) => s.model);
  const apiKey = useAiProvider((s) => s.apiKey);
  const setOpenai = useAiProvider((s) => s.setOpenai);

  const presets = [
    { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder" },
    {
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-chat",
    },
    { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ];

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-foreground/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] text-muted-foreground/70">Quick setup:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setOpenai({ baseUrl: p.baseUrl, model: model.trim() || p.model })}
            className="rounded-md border border-border/50 bg-card/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>
      <OpenAiField
        label="Base URL"
        value={baseUrl}
        placeholder="http://localhost:11434/v1"
        onChange={(v) => setOpenai({ baseUrl: v })}
      />
      <OpenAiField
        label="Model"
        value={model}
        placeholder="qwen2.5-coder"
        onChange={(v) => setOpenai({ model: v })}
      />
      <OpenAiField
        label="API key (optional)"
        value={apiKey}
        placeholder="sk-…  ·  leave empty for local"
        type="password"
        onChange={(v) => setOpenai({ apiKey: v })}
      />
      <p className="text-[11px] text-muted-foreground/80">
        Stored locally on this machine. The PR diff is sent to this endpoint over HTTP. Tip: Ollama
        is free &amp; offline; DeepSeek / OpenRouter cost roughly 10× less than Claude.
      </p>
    </div>
  );
}

function OpenAiField({
  label,
  value,
  placeholder,
  type,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Input renders the native control
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        size="sm"
        spellCheck={false}
        autoComplete="off"
        className="w-full"
      />
    </label>
  );
}
