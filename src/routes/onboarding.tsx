import { ReviewlyGlyph } from "@/components/reviewly-glyph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeviceStart, Viewer } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Step = "connect" | "repos" | "ready";
const STEPS: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "repos", label: "Repos" },
  { id: "ready", label: "Ready" },
];

export function OnboardingPage() {
  const signedIn = useAuth((s) => s.signedIn);
  const [step, setStep] = useState<Step>("connect");

  // Advance to the repo picker as soon as GitHub auth lands.
  useEffect(() => {
    if (signedIn) setStep((s) => (s === "connect" ? "repos" : s));
  }, [signedIn]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center text-primary">
            <ReviewlyGlyph size={24} />
          </div>
          <div>
            <h1 className="text-base font-medium tracking-tight">Reviewly</h1>
            <p className="text-xs text-muted-foreground">Desktop pull-request review console</p>
          </div>
        </div>

        <StepRail current={step} />

        <div className="mt-4 rounded-xl border border-hairline bg-card/50 p-5">
          {step === "connect" && <ConnectStep />}
          {step === "repos" && <ReposStep onContinue={() => setStep("ready")} />}
          {step === "ready" && <ReadyStep />}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Reviewly only stores your GitHub access token in the OS keychain.
        </p>
      </div>
    </div>
  );
}

/** Numbered progress rail for the wizard. */
function StepRail({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
              i < idx
                ? "bg-primary text-primary-foreground"
                : i === idx
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-foreground/[0.06] text-muted-foreground/60",
            )}
          >
            {i < idx ? <Check className="size-3" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-[11px] font-medium",
              i <= idx ? "text-foreground" : "text-muted-foreground/50",
            )}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className={cn("h-px flex-1", i < idx ? "bg-primary/40" : "bg-hairline")} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — connect GitHub (gh CLI token reuse, or device flow)
// ---------------------------------------------------------------------------

type Mode = "choosing" | "gh" | "device";

function ConnectStep() {
  const [mode, setMode] = useState<Mode>("choosing");
  const [ghAvailable, setGhAvailable] = useState<boolean | null>(null);
  const [start, setStart] = useState<DeviceStart | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuth((s) => s.set);

  useEffect(() => {
    invoke<boolean>("auth_gh_available")
      .then(setGhAvailable)
      .catch(() => setGhAvailable(false));
  }, []);

  async function useGhCli() {
    setError(null);
    setMode("gh");
    setWaiting(true);
    try {
      const viewer = await invoke<Viewer>("auth_use_gh_cli");
      setAuth({ signedIn: true, viewer, loading: false });
    } catch (e) {
      setError(String(e));
      setMode("choosing");
    } finally {
      setWaiting(false);
    }
  }

  async function beginDeviceFlow() {
    setError(null);
    setMode("device");
    try {
      const ds = await invoke<DeviceStart>("auth_device_start");
      setStart(ds);
      setWaiting(true);
      const viewer = await invoke<Viewer>("auth_device_poll", {
        deviceCode: ds.device_code,
        interval: ds.interval,
      });
      setAuth({ signedIn: true, viewer, loading: false });
    } catch (e) {
      setError(String(e));
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-foreground">Connect your GitHub</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Reviewly reads your pull requests with your own token — nothing runs on our servers.
        </p>
      </div>

      {error && <AuthError raw={error} />}

      {mode === "choosing" && (
        <ChoosingView ghAvailable={ghAvailable} onUseGh={useGhCli} onUseDevice={beginDeviceFlow} />
      )}
      {mode === "gh" && waiting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Reading token from gh CLI…
        </div>
      )}
      {mode === "device" &&
        (start ? (
          <DeviceCodePrompt start={start} waiting={waiting} />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Requesting device code…
          </div>
        ))}
    </div>
  );
}

function ChoosingView({
  ghAvailable,
  onUseGh,
  onUseDevice,
}: {
  ghAvailable: boolean | null;
  onUseGh: () => void;
  onUseDevice: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onUseGh} disabled={ghAvailable !== true}>
        <Terminal className="size-3.5" />
        Use GitHub CLI {ghAvailable === false && "(not signed in)"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        {ghAvailable === true
          ? "Reuses the token from `gh auth login` — SSO orgs you already authorized work right away."
          : ghAvailable === false
            ? "Run `gh auth login` in a terminal to enable this option, or use device flow below."
            : "Checking…"}
      </p>

      <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground/70">
        <div className="h-px flex-1 bg-hairline" />
        or
        <div className="h-px flex-1 bg-hairline" />
      </div>

      <Button variant="outline" className="w-full" onClick={onUseDevice}>
        <ExternalLink className="size-3.5" />
        Sign in with device flow
      </Button>
    </div>
  );
}

function DeviceCodePrompt({ start, waiting }: { start: DeviceStart; waiting: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(start.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy code");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">One-time code</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 cursor-pointer select-all rounded-md border border-hairline bg-background/60 px-3 py-2 font-mono text-lg tracking-[0.3em] text-foreground">
            {start.user_code}
          </code>
          <Button size="icon" variant="outline" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      <Button className="w-full" onClick={() => safeOpenUrl(start.verification_uri)}>
        Open GitHub
        <ExternalLink className="size-3.5" />
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        {waiting ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            Waiting for authorization…
          </span>
        ) : (
          "Enter the code, approve scopes, and come back."
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — pick the repos you review (scopes the PR lists; optional)
// ---------------------------------------------------------------------------

function ReposStep({ onContinue }: { onContinue: () => void }) {
  const watched = useWatchedRepos((s) => s.repos);
  const toggle = useWatchedRepos((s) => s.toggle);
  const [query, setQuery] = useState("");
  const repos = useQuery({
    queryKey: ["repos"],
    queryFn: () => invoke<string[]>("gh_list_repos"),
    staleTime: 5 * 60_000,
  });

  const watchedSet = useMemo(() => new Set(watched), [watched]);
  const filtered = useMemo(() => {
    const all = repos.data ?? [];
    const q = query.trim().toLowerCase();
    return (q ? all.filter((r) => r.toLowerCase().includes(q)) : all).slice(0, 200);
  }, [repos.data, query]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Pick the repos you review</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your PR lists and dashboard are scoped to these. Leave empty to see everything — you can
          change this anytime.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={repos.isLoading ? "Loading your repos…" : "Filter your repositories…"}
          size="sm"
          className="w-full pl-8"
        />
      </div>

      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {repos.isLoading ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No repositories.</p>
        ) : (
          filtered.map((r) => {
            const on = watchedSet.has(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  on ? "bg-primary/[0.07] text-foreground" : "hover:bg-foreground/[0.04]",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="truncate">{r}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground/70">
          {watched.length > 0 ? `${watched.length} selected` : "Watching everything"}
        </span>
        <Button size="sm" onClick={onContinue}>
          Continue
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — you're in
// ---------------------------------------------------------------------------

function ReadyStep() {
  const navigate = useNavigate();
  const viewer = useAuth((s) => s.viewer);
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/30">
        <Sparkles className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          You're in{viewer?.login ? `, @${viewer.login}` : ""}.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Free and open source — no account, no credit card.
        </p>
      </div>

      <div className="space-y-2 rounded-lg bg-foreground/[0.03] p-3 text-left">
        <Perk
          icon={ShieldCheck}
          text="Runs on your machine — only the diff is sent to the AI you pick."
        />
        <Perk
          icon={Eye}
          text="Guided AI tours, inline review, checks & Dependabot — all local-first."
        />
      </div>

      <Button className="w-full" onClick={() => navigate({ to: "/" })}>
        Start reviewing
        <ArrowRight className="size-3.5" />
      </Button>
    </div>
  );
}

function Perk({ icon: Icon, text }: { icon: typeof Eye; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
}

/** Map a raw backend auth error to a specific, actionable message. The raw
 * string is still shown (collapsed) for anyone who wants the details. */
function explainAuthError(raw: string): { title: string; hint: string } {
  const e = raw.toLowerCase();
  if (e.includes("spawn gh"))
    return {
      title: "GitHub CLI isn't installed",
      hint: "We couldn't find the gh command on your PATH. Install it from cli.github.com, or use the device flow below instead.",
    };
  if (e.includes("gh auth token") || e.includes("not logged"))
    return {
      title: "You're not signed in to the GitHub CLI",
      hint: "Run gh auth login in a terminal, then try again — or use the device flow below.",
    };
  if (e.includes("client_id") || e.includes("client id"))
    return {
      title: "Device flow isn't configured in this build",
      hint: "This build is missing its GitHub client ID. Use the GitHub CLI option instead.",
    };
  if (e.includes("http error") || e.includes("dns error") || e.includes("tcp connect"))
    return {
      title: "Couldn't reach GitHub",
      hint: "Check your internet connection (and any VPN or proxy), then try again.",
    };
  if (e.includes("expired"))
    return {
      title: "The sign-in code expired",
      hint: "The code is only valid for a few minutes. Start the device flow again.",
    };
  if (e.includes("denied"))
    return {
      title: "Sign-in was denied",
      hint: "The request was declined on GitHub. Start again and approve it.",
    };
  if (e.includes("timed out") || e.includes("timeout"))
    return {
      title: "Sign-in timed out",
      hint: "We stopped waiting for you to authorize on GitHub. Start the device flow again.",
    };
  if (e.includes("bad credentials") || e.includes("401"))
    return {
      title: "GitHub rejected the token",
      hint: "The token is invalid or expired. Try signing in again.",
    };
  if (e.includes("rate limit") || e.includes("403"))
    return {
      title: "GitHub rate-limited the request",
      hint: "Wait a minute, then try again.",
    };
  return {
    title: "Sign-in failed",
    hint: "Something went wrong connecting to GitHub — the details below may help.",
  };
}

function AuthError({ raw }: { raw: string }) {
  const { title, hint } = explainAuthError(raw);
  return (
    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground/60 transition-colors hover:text-muted-foreground">
          Technical details
        </summary>
        <pre className="mt-1.5 overflow-auto rounded-md border border-hairline bg-background/50 p-2 text-[11px] text-muted-foreground">
          {raw}
        </pre>
      </details>
    </div>
  );
}
