import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useMemo, useState } from "react";

import { onboarding } from "@/app/onboarding";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { run, useEffectQuery } from "@/effect/runtime";
import type { DeviceStart } from "@/effect/schema";
import { AppSettings } from "@/effect/services/AppSettings";
import { Auth, useAuth } from "@/effect/services/Auth";
import { GitHub } from "@/effect/services/GitHub";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { safeOpenUrl } from "@/lib/ui";
import { APP_STORE } from "@/lib/edition";
import { cn } from "@/lib/utils";

/**
 * The first screen, once: sign in with the device flow, or borrow the token the
 * GitHub CLI already has; then the repositories you review. Nothing else is
 * asked before the Inbox.
 */
export function FirstRunScreen() {
  useTitleSlot(<span className="text-[13px] text-ink-2">Reviewly</span>, "page");
  const auth = useAuth();
  const [step, setStep] = useState<"connect" | "repos">("connect");
  useEffect(() => {
    onboarding.set(true);
    return () => onboarding.set(false);
  }, []);
  useEffect(() => {
    if (auth.signedIn) setStep("repos");
  }, [auth.signedIn]);
  return (
    <div className="flex h-full items-center justify-center bg-page">
      <div className="w-[460px]">
        <p className="tnum text-[12px] text-ink-3">
          {step === "connect" ? "1 of 2 · your account" : "2 of 2 · what you review"}
        </p>
        {step === "connect" ? <Connect /> : <PickRepos />}
      </div>
    </div>
  );
}

function Connect() {
  const [kind, setKind] = useState<"cloud" | "enterprise">("cloud");
  const [enterpriseHost, setEnterpriseHost] = useState("");
  const [token, setToken] = useState("");
  const host =
    kind === "cloud"
      ? "github.com"
      : enterpriseHost
          .trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "")
          .toLowerCase();
  const cli = useEffectQuery(
    ["gh-cli", host],
    Effect.flatMap(Auth, (a) => a.ghCliAvailable(host || "github.com")),
    // The sandboxed App Store edition can't run gh: device flow or a token only.
    { enabled: !APP_STORE },
  );
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [busy, setBusy] = useState<"device" | "cli" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startDevice = async () => {
    setBusy("device");
    setError(null);
    try {
      const d = await run(Effect.flatMap(Auth, (a) => a.deviceStart));
      setDevice(d);
      safeOpenUrl(d.verification_uri);
      await run(Effect.flatMap(Auth, (a) => a.devicePoll(d.device_code, d.interval)));
    } catch (e) {
      setError(explain(e));
      setDevice(null);
    } finally {
      setBusy(null);
    }
  };
  const useCli = async () => {
    setBusy("cli");
    setError(null);
    try {
      await run(Effect.flatMap(Auth, (a) => a.useGhCli(host || "github.com")));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };
  const useToken = async () => {
    setBusy("cli");
    setError(null);
    try {
      await run(Effect.flatMap(Auth, (a) => a.useToken(host, token)));
      setToken("");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (device) navigator.clipboard?.writeText(device.user_code).catch(() => {});
  }, [device]);
  return (
    <>
      <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">
        Your pull requests, in the order they need you.
      </h1>
      <p className="mt-2 text-[13px] text-ink-2">
        Reviewly reads your GitHub server directly and keeps everything on this machine. Sign in
        once.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <div className="grid grid-cols-2 rounded-md border border-input bg-sink p-0.5">
          {(["cloud", "enterprise"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setKind(value);
                setDevice(null);
                setError(null);
              }}
              className={cn(
                "h-7 rounded-[4px] text-[12.5px] transition-colors",
                kind === value ? "bg-raise text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {value === "cloud" ? "GitHub.com" : "Enterprise Server"}
            </button>
          ))}
        </div>
        {kind === "enterprise" ? (
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-2">
            Server hostname
            <input
              autoFocus
              value={enterpriseHost}
              onChange={(event) => setEnterpriseHost(event.target.value)}
              placeholder="github.company.com"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-8 rounded-md border border-input bg-sink px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
            />
          </label>
        ) : device ? (
          <div className="rounded-lg border border-edge bg-card p-4">
            <p className="text-[12.5px] text-ink-2">
              Enter this code on GitHub — it is already on your clipboard.
            </p>
            <p className="mono mt-2 text-[22px] tracking-[0.12em] text-ink">{device.user_code}</p>
            <p className="mt-2 flex items-center gap-2 text-[12.5px] text-ink-3">
              Waiting for GitHub…
              <button
                type="button"
                onClick={() => safeOpenUrl(device.verification_uri)}
                className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
              >
                Open GitHub again
              </button>
            </p>
          </div>
        ) : kind === "cloud" ? (
          <Button variant="default" size="default" onClick={startDevice} disabled={busy !== null}>
            Sign in with GitHub
          </Button>
        ) : null}
        {APP_STORE ? null : (
          <Button
            variant="outline"
            size="default"
            onClick={useCli}
            disabled={busy !== null || cli.data === false || !host}
          >
            Use the GitHub CLI
          </Button>
        )}
        {kind === "enterprise" ? (
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Personal access token"
              type="password"
              autoComplete="off"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-sink px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-edge"
            />
            <Button
              variant="outline"
              size="default"
              onClick={useToken}
              disabled={busy !== null || !host || !token.trim()}
            >
              Connect
            </Button>
          </div>
        ) : null}
        {APP_STORE ? null : (
        <p className="text-[12px] text-ink-3">
          {cli.data === false
            ? kind === "enterprise"
              ? `Run gh auth login --hostname ${host || "your-server"}, or use a personal access token.`
              : "The gh CLI isn’t signed in on this machine. Run `gh auth login` in a terminal, or use the device flow above."
            : cli.data
              ? `Reuses the token already authorised for ${host || "this server"}.`
              : "Checking for the GitHub CLI…"}
        </p>
        )}
      </div>
      {busy === "cli" ? (
        <p className="mt-3 text-[12.5px] text-ink-3">Asking gh for the token…</p>
      ) : null}
      {error ? <p className="mt-3 text-[12.5px] text-del">{error}</p> : null}
      <p className="mt-8 text-[12px] text-ink-3">
        The server and token go in the OS keychain and nowhere else.
      </p>
    </>
  );
}

/** The error in the reviewer's words, with what to do about it. */
function explain(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (m.includes("spawn gh") || m.includes("not found")) return "The GitHub CLI isn’t installed.";
  if (m.includes("gh auth") || m.includes("not logged"))
    return "You aren’t signed in to the GitHub CLI. Run `gh auth login` first.";
  if (m.includes("client_id")) return "The device flow isn’t configured in this build.";
  if (m.includes("dns") || m.includes("connect") || m.includes("http error"))
    return "Couldn’t reach GitHub. Check the network and try again.";
  if (m.includes("expired")) return "The code expired. Start again.";
  if (m.includes("denied")) return "GitHub said no to the sign-in.";
  if (m.includes("timed out") || m.includes("timeout")) return "GitHub took too long. Try again.";
  if (m.includes("bad credentials") || m.includes("401")) return "GitHub rejected the token.";
  if (m.includes("rate limit") || m.includes("403"))
    return "GitHub rate-limited the request. A minute, then again.";
  return e instanceof Error ? e.message : String(e);
}

/** The repositories whose pull requests the Inbox ranks; empty means the first few GitHub lists. */
function PickRepos() {
  const navigate = useNavigate();
  const auth = useAuth();
  const watched = usePrefs((p) => p.watchedRepos);
  const all = useEffectQuery(
    ["repos"],
    Effect.flatMap(GitHub, (g) => g.repos),
  );
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all.data ?? [])
      .filter((r) => !needle || r.toLowerCase().includes(needle))
      .slice(0, 200);
  }, [all.data, q]);
  const toggle = (r: string) =>
    prefsStore.update((p) => ({
      ...p,
      watchedRepos: p.watchedRepos.includes(r)
        ? p.watchedRepos.filter((x) => x !== r)
        : [...p.watchedRepos, r],
    }));
  const finish = () => {
    run(Effect.flatMap(AppSettings, (a) => a.setWatchedRepos(prefsStore.get().watchedRepos))).catch(
      () => {},
    );
    onboarding.set(false);
    toast.done(`You’re in${auth.viewer ? `, ${auth.viewer.login}` : ""}`);
    void navigate({ to: "/inbox" });
  };
  return (
    <>
      <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">
        The repositories you review.
      </h1>
      <p className="mt-2 text-[13px] text-ink-2">
        The Inbox ranks what happens here. Pull requests elsewhere still show up when someone asks
        you. Leave it empty and the first few GitHub lists are watched; Settings changes it any
        time.
      </p>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={all.data ? "Filter your repositories" : "Loading your repositories…"}
        className="mt-5 h-8 w-full rounded-md border border-input bg-sink px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
        onKeyDown={(e) => e.stopPropagation()}
      />
      <ul className="mt-2 max-h-[300px] overflow-y-auto rounded-lg border border-edge bg-card scrollbar-thin">
        {shown.map((r) => {
          const on = watched.includes(r);
          return (
            <li key={r}>
              <button
                type="button"
                onClick={() => toggle(r)}
                aria-pressed={on}
                className={cn(
                  "flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] hover:bg-raise/50",
                  on ? "text-ink" : "text-ink-2",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded-[3px] border text-[10px]",
                    on ? "border-ink bg-ink text-[#141414]" : "border-edge",
                  )}
                  aria-hidden
                >
                  {on ? "✓" : ""}
                </span>
                <span className="mono truncate">{r}</span>
              </button>
            </li>
          );
        })}
        {all.data && shown.length === 0 ? (
          <li className="px-3 py-2 text-[12.5px] text-ink-3">No repository matches.</li>
        ) : null}
      </ul>
      <div className="mt-4 flex items-center justify-between">
        <span className="tnum text-[12.5px] text-ink-3">
          {watched.length ? `${watched.length} watched` : "Watching the first few GitHub lists"}
        </span>
        <Button variant="default" size="default" onClick={finish}>
          Start reviewing
        </Button>
      </div>
    </>
  );
}
