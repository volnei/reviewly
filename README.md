<p align="center">
  <img src="assets/logo.png" alt="Reviewly" width="128" />
</p>

<h1 align="center">Reviewly</h1>

<p align="center">
  <b>A fast, local-first desktop app for reviewing GitHub pull requests — with AI that runs on your own machine.</b>
</p>

Reviewly is a native desktop console (macOS, Windows, Linux) that turns PR review from a dozen browser tabs into one focused workspace. It pulls the PRs that need *you*, lays out the diff the way a reviewer actually reads it, lets a local AI walk you through the change, and posts your review back to GitHub — without sending your code to any server but the one you choose.

Built with **Tauri 2** (Rust + React). Free and open source under the [GPL-3.0](LICENSE).

> **Local-first by design.** Your GitHub token lives in the OS keychain. AI review runs through *your* local CLI (Claude, Codex, Gemini) or *your* own OpenAI-compatible endpoint — only the PR diff is ever sent, and there is no Reviewly server in the middle.

---

## Table of contents

- [Why Reviewly](#why-reviewly)
- [Features](#features)
  - [The review inbox](#the-review-inbox)
  - [Pull request list & search](#pull-request-list--search)
  - [Reading the diff](#reading-the-diff)
  - [Writing your review](#writing-your-review)
  - [AI review](#ai-review)
  - [Checks & CI](#checks--ci)
  - [Dependabot](#dependabot)
  - [Local repository integration](#local-repository-integration)
  - [Notifications](#notifications)
  - [Desktop niceties](#desktop-niceties)
- [How it works](#how-it-works)
- [Install](#install)
- [Setting up AI review](#setting-up-ai-review)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Privacy & security](#privacy--security)
- [Build from source](#build-from-source)
- [Tech stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

---

## Why Reviewly

Reviewing pull requests in the browser means juggling tabs, losing your place in long diffs, copy-pasting code into a chat window, and re-checking the same "needs my review" filter all day. Reviewly fixes that:

- **One inbox for the work that's yours.** Review-requests, your own PRs, what's ready to merge, what's blocked — grouped and always fresh.
- **A diff built for reviewers.** Unified or split, syntax-highlighted, with expandable context, per-file "viewed" tracking, and inline comments that batch into a single review.
- **AI that's actually private.** A guided tour of the change or a back-and-forth chat, powered by the AI CLI you already have installed or any endpoint you point it at. Your diff never touches a Reviewly backend.
- **Native, fast, offline-friendly.** PRs are cached locally in SQLite, so the list is instant and survives a flaky connection. A background poller keeps it current and pings you when a new review lands.

---

## Features

### The review inbox

The **Dashboard** (`⌘1`) is the home screen — everything that needs your attention, grouped:

- **Needs your review** — PRs that requested you, oldest first, with an "aging" badge once they pass a week.
- **Needs your attention** — your open PRs with requested changes or failing CI.
- **Ready to merge** — your approved PRs.
- **Awaiting review** — your PRs still waiting on reviewers.
- **Drafts** — your work in progress.

Sections are collapsible, refresh automatically, and show how long ago they synced. Each row carries the title, author, repo/number, approval state, and a live CI status dot.

### Pull request list & search

The **Pull Requests** page (`⌘2`) is the full, filterable list:

- **Filter** by state (open / draft / merged / closed), repository, labels (include → exclude → off), or "CI failing".
- **Group** by repository or author; **sort** by updated, created, or title.
- **Search** with `/` — matches title, author, or PR number. Active filters show as removable chips.
- **Virtualized** rendering handles thousands of PRs without lag.
- **Keyboard-driven:** `j` / `k` to move, `Enter` to open. Your scroll position is remembered per view.

When you've picked repositories to watch, the list is served straight from the **local SQLite cache** — instant and available offline — and kept fresh by the background poller. Otherwise it falls back to GitHub search.

### Reading the diff

The **PR detail** view organizes a pull request into four tabs — **Files**, **Conversation**, **Commits**, and **Checks** — with a file-tree sidebar on the Files tab.

The diff viewer is the centerpiece:

- **Unified or split** view, toggled with `⌘B`.
- **Syntax highlighting** per language (Prism).
- **Expand context** — unfold the unchanged lines between hunks to see the full surrounding file.
- **Hide whitespace-only** changes and **wrap long lines** on demand.
- **Viewed-files tracking** — mark files reviewed as you go (auto-marks when you scroll to the end); the sidebar shows "N of M reviewed", keyed to the current head commit so a force-push resets it.

The **file-tree sidebar** decorates each file with its git status, the `+`/`−` change counts, a change-frequency heatmap, and **CODEOWNERS** hints when a local clone is available.

### Writing your review

Reviewly batches your feedback into a single GitHub review, just like the web UI — but faster:

- **Inline comments** — select one or more lines in the diff to open a composer. Comments are saved to a **per-PR draft** that survives navigation, refresh, and app restarts.
- **Review submit** — choose **Comment**, **Approve**, or **Request changes**; write a summary in Markdown; review your pending inline comments (jump to any of them) and submit with `⌘↵`. Reviewly remembers your last verdict and confirms the review actually landed on GitHub before clearing the draft.
- **Threads, replies, reactions** — read and reply to existing review threads, resolve/unresolve them, and add emoji reactions.
- **Labels & title** — apply labels inline; edit the PR title in place if you're the author.
- An **unsaved-draft guard** warns you before you navigate away with pending comments.

### AI review

Reviewly drives an AI you control — a local CLI or your own endpoint — to help you understand a change. Two modes:

**Guided tour.** One click and the AI reads the whole PR and walks you through it in a sensible order: the core change first, then what depends on it. Each step is one of *orientation*, *worth a comment*, *question*, or *praise*, and can jump you to the relevant file/line or pre-fill a suggested inline comment. The tour is generated in the background (so it survives navigation), saved per-PR, and knows to offer a regenerate when the PR's head commit changes.

**Ask AI.** A floating chat panel for a back-and-forth about the PR. Responses **stream token-by-token**. Conversations are kept per-PR, and if you have the repo cloned locally the AI runs *inside the clone* so it can read the real files, not just the diff. The AI's replies can propose actions — add a review comment, apply a label, request a reviewer — that you apply with one click.

**Providers** (configure in Settings):

| Provider | How it runs | Needs |
| --- | --- | --- |
| **Claude** | the `claude` CLI on your `PATH` | [Claude Code](https://claude.com/claude-code) installed & signed in |
| **Codex** | the `codex` CLI on your `PATH` | OpenAI Codex CLI installed |
| **Gemini** | the `gemini` CLI on your `PATH` | Gemini CLI installed |
| **OpenAI-compatible** | an HTTP endpoint you provide | base URL + model (+ optional API key) |

The OpenAI-compatible option works with OpenAI, Ollama, LM Studio, OpenRouter, and anything else that speaks the same API. A **custom instructions** field in Settings is prepended to every prompt, so you can encode your team's review standards once.

### Checks & CI

The **Checks** tab shows every check run on the PR's head commit — GitHub Actions and third-party status checks alike — with status, timing, and expandable failure annotations (file, line, message). The tab color is **required-aware**: optional failures won't turn it red.

Each check has a **Re-run** button that picks the narrowest possible scope — re-running just that Actions job (or, when the job can't be pinned down, only the failed jobs of that run), never the whole suite.

### Dependabot

The **Dependabot** page lists security alerts for a repo, sorted by severity, with dismiss/reopen actions and clear messaging when the feature is disabled or your token lacks access.

### Local repository integration

Point Reviewly at your local clones and it adds a layer of git intelligence:

- **Repo browser** — a file tree decorated with git status, staged/unstaged markers, change counts, a churn heatmap, and CODEOWNERS; plus a syntax-highlighted file viewer, a **Changes** (branch-vs-base) view, and a **History** (recent commits with per-commit diffs) view.
- **Quick-open** any file with `⌘P`.
- **Branch switcher** and worktree list.
- **Check out a PR** into the clone in one action.
- **Open a new PR** straight from the app.

When a PR's repo is cloned, **Ask AI** runs in that working directory automatically.

### Notifications

The **Notifications** page (`⌘3`) mirrors your GitHub notifications — All, Reviews & comments, or Mentions — with `j`/`k`/`Enter` navigation, `e` to mark read, "Mark all read", and an undo toast.

### Desktop niceties

- **Menu-bar tray** showing your pending-review count; click to bring the app forward.
- **Command palette** (`⌘K`) — jump to any loaded PR, paste a PR URL (full or `owner/repo#123`) to open it, navigate anywhere, or check for updates.
- **Pinboard** — pin PRs, commits, or files to a bar for quick return.
- **Clipboard sniff** — copy a GitHub PR link anywhere and Reviewly offers to open it.
- **Native window vibrancy** on macOS and **Mica** on Windows 11.
- **Auto-update** — silent check on launch, one-click "Restart & install".
- **OS notifications** when a new review request arrives.

---

## How it works

Reviewly is a **Tauri 2** application: a Rust core with a React front end, shipping as a single native binary per platform.

```
┌──────────────────────── Desktop window (WebView) ────────────────────────┐
│  React 18 · TanStack Router/Query · Zustand · Tailwind v4                 │
│  diff viewer · review composer · AI chat & guided tour · command palette  │
└───────────────▲───────────────────────────────────────────▲──────────────┘
                │ Tauri commands (invoke)          events ────┘ (pr:new, ai:chunk, …)
┌───────────────┴──────────────────────────────────────────────────────────┐
│  Rust core                                                                │
│   • reqwest → GitHub REST + GraphQL                                        │
│   • keyring → OAuth token in the OS keychain                              │
│   • tauri-plugin-sql (SQLite) → PR cache, review drafts, settings         │
│   • background poller (60 s) → tray count, new-PR notifications, sync      │
│   • AI bridge → spawns your local CLI or calls your HTTP endpoint,         │
│                 streaming output back over a Tauri Channel                 │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data flow.** The front end calls typed Rust commands; the Rust core talks to GitHub and persists to a local SQLite database. PRs you've chosen to watch are cached so the list is instant and offline-capable.
- **Staying fresh.** A Rust poller runs every 60 seconds: it updates the tray count, fires an OS notification for newly-requested reviews, and nudges the front end to reconcile. The UI also syncs on launch, on window focus, and on a periodic tick.
- **AI bridge.** When you ask for a tour or a chat turn, the core builds a prompt from the PR diff (and conversation, and your custom instructions) and either spawns your chosen CLI or calls your endpoint, streaming the output back token-by-token. Nothing is sent anywhere except the backend you configured.
- **Auth.** Sign-in uses GitHub's **OAuth Device Flow**; the token is stored in the platform keychain (Keychain / Credential Manager / Secret Service), never on disk in plaintext.

---

## Install

Download the latest installer for your platform from the [**Releases**](https://github.com/volnei/reviewly/releases) page:

- **macOS** — `Reviewly_<version>_universal.dmg` (Apple Silicon + Intel, signed & notarized)
- **Windows** — `Reviewly_<version>_x64-setup.exe` or `.msi`
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

On first launch, Reviewly walks you through a short setup: connect your GitHub account (a device code you approve in the browser), pick the repositories to watch, and you're in. The app updates itself from then on.

> No account, no subscription, no telemetry. Reviewly is free and open source.

## Setting up AI review

AI features are optional — Reviewly is a great review client without them. To turn them on, open **Settings → AI review** and pick a provider:

- **Already have an AI CLI?** Select **Claude**, **Codex**, or **Gemini** — Reviewly detects whether the binary is on your `PATH` and signed in. (For Claude, install [Claude Code](https://claude.com/claude-code) and run `claude` once to log in.)
- **Prefer your own endpoint?** Choose **OpenAI-compatible** and enter a base URL, model, and optional API key — point it at OpenAI, a local Ollama/LM Studio server, OpenRouter, or anything that speaks the OpenAI API.

Add **custom review instructions** in the same panel to bake your team's standards into every tour and chat.

## Keyboard shortcuts

Press `?` anywhere for the in-app cheatsheet. (`⌘` is `Ctrl` on Windows/Linux.)

| Key | Action |
| --- | --- |
| `⌘K` | Command palette |
| `⌘B` | Toggle unified ↔ split diff |
| `⌘1` … `⌘5` | Dashboard · PRs · Repos · Notifications · Dependabot |
| `⌘,` | Settings |
| `⌘=` / `⌘-` / `⌘0` | Zoom in / out / reset |
| `?` | Keyboard shortcuts cheatsheet |
| `g` then `d`/`r`/`l`/`n`/`a`/`s` | Go to Dashboard / PRs / Repos / Notifications / Dependabot / Settings |
| `/` | Focus the filter (lists) |
| `j` / `k` | Move cursor down / up (lists) |
| `Enter` | Open the highlighted item |
| `e` | Mark notification read |
| `⌘↵` | Submit review / comment |
| `⌘P` | Quick-open a file (repo view) |

## Privacy & security

- **Your token stays local.** The GitHub OAuth token is held in the OS keychain, not in a config file. The OAuth client ID is public (as GitHub intends) — there is no client secret.
- **Your code stays yours.** Reviewly has no backend. The only outbound calls are to **GitHub** (to do your review) and to **the AI backend you explicitly configure** (which receives only the PR diff and conversation, never your whole repo). If you use a local CLI or local model, nothing leaves your machine at all.
- **No telemetry.** Reviewly doesn't phone home, track usage, or collect analytics.

## Build from source

**Prerequisites**

1. **Bun** ≥ 1.3 — `curl -fsSL https://bun.sh/install | bash`
2. **Rust** (stable) — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. Platform toolchain for Tauri: Xcode Command Line Tools (macOS), the [Tauri Linux deps](https://tauri.app/start/prerequisites/) (Linux), or the MSVC build tools (Windows).

**Run**

```bash
bun install
bun run tauri dev       # launch the desktop app with hot reload
```

**Other scripts**

```bash
bun run typecheck       # tsc --noEmit
bun run lint            # biome check
bun run build           # build the front end only (Vite)
bun run tauri build     # produce installers in src-tauri/target/release/bundle
```

The GitHub OAuth client ID ships in [`src-tauri/.cargo/config.toml`](src-tauri/.cargo/config.toml) (`REVIEWLY_GITHUB_CLIENT_ID`) — it's public, so the app builds and signs in out of the box. To use your own OAuth app instead, register one with **Device Flow enabled** and the `repo`, `read:user`, `notifications`, and `workflow` scopes, then replace the value there.

**Releases.** Pushing a `vX.Y.Z` tag runs the [release workflow](.github/workflows/release.yml), which builds, signs, and notarizes installers for all three platforms and drafts a GitHub Release. macOS code-signing/notarization and the updater signing key are read from repository secrets, so forks build unsigned until those are configured.

## Tech stack

**Front end** — React 18, TypeScript, [TanStack Router](https://tanstack.com/router) & [Query](https://tanstack.com/query), [Zustand](https://github.com/pmndrs/zustand) (persisted to SQLite), Tailwind CSS v4, Base UI components, Prism syntax highlighting, TanStack Virtual, Sonner, Vite.

**Desktop shell** — [Tauri 2](https://tauri.app): SQL (SQLite), global-shortcut, notification, clipboard-manager, dialog, opener, process, os, updater, and window-state plugins, plus `window-vibrancy` for the macOS/Windows backdrop.

**Rust core** — Tokio, reqwest (GitHub REST + GraphQL over rustls), serde, chrono, the `keyring` crate for the OS keychain, and `tracing` for logs.

**Tooling** — [Bun](https://bun.sh) for installs/scripts, [Biome](https://biomejs.dev) for lint/format.

## Contributing

Issues and pull requests are welcome. Before opening a PR, please run `bun run typecheck`, `bun run lint`, and (for Rust changes) `cargo check` in `src-tauri/`. The CI workflow runs the same checks on every push.

## License

Reviewly is free software, licensed under the **[GNU General Public License v3.0 or later](LICENSE)**. You're free to use, study, share, and modify it; derivative works must remain under the GPL.
