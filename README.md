# Reviewly

Desktop pull-request review console for GitHub. Tauri 2 + React + Tailwind v4 + Zustand + TanStack Query/Router, built with `bun` and linted with `biome`. Mirrors the architecture of [`quadrant`](../quadrant) but targets PR review workflows instead of incident triage.

## Stack

- **Frontend**: React 18, Vite, Tailwind v4, [coss/ui](https://coss.com/ui) registry (base-ui + radix-style components copied locally)
- **State / data**: Zustand (persisted to SQLite), TanStack Query, TanStack Router
- **Desktop shell**: Tauri 2 (window vibrancy on macOS / Mica on Windows, menu-bar tray, global shortcuts, OS notifications, clipboard sniff)
- **Backend**: Rust with `reqwest` against the GitHub REST API, `keyring` for the OAuth token, `tauri-plugin-sql` (SQLite) for local persistence
- **AI**: Local `claude` CLI streamed over a Tauri `Channel` (Ask AI + Guide tab)

## Prerequisites

1. **bun** ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
2. **Rust** toolchain + Xcode CLI tools on macOS
3. **GitHub OAuth App** registered at <https://github.com/settings/developers> with **Enable Device Flow** turned on. Required scopes: `repo`, `read:user`, `notifications`. Copy the public Client ID (starts with `Ov23…`) and place it in [`src-tauri/.cargo/config.toml`](src-tauri/.cargo/config.toml) under `REVIEWLY_GITHUB_CLIENT_ID`.

## Running

```bash
bun install
bun run tauri dev       # launches the desktop app with HMR
bun run typecheck       # tsc --noEmit
bun run lint            # biome check
bun run build           # vite build (frontend only)
bun run tauri build     # produces .app / .dmg in src-tauri/target/release/bundle
```

The first launch will prompt for the GitHub Device Flow code and stash the token in the OS keychain.

## Layout

```
src/
├── app/                    # layout, sidebar, title-bar, command palette, pinboard, global hooks
├── routes/                 # dashboard, onboarding, prs, pr-detail, notifications, investigations, settings
├── components/             # diff-viewer, review-submit-dialog, ask-ai, page-header, ui/* (coss/shadcn)
├── lib/                    # tauri.ts (typed invoke + GH types), router, sql-storage, diff parser, utils
├── stores/                 # zustand stores (ui, pinboard, investigations, review-draft, auth)
└── styles/globals.css      # tailwind theme, vibrancy css vars, prose-reviewly markdown styles

src-tauri/
├── src/
│   ├── auth/device.rs      # OAuth Device Flow
│   ├── clients/github.rs   # reqwest wrapper + typed structs
│   ├── commands/           # auth, search, pulls, reviews, comments, notifications, ai
│   ├── workers/github_poll.rs  # 60s polling for review-requested PRs → emits pr:new / pr:tick
│   ├── creds.rs            # keyring wrapper
│   ├── tray.rs             # menu-bar tray with PR count
│   └── lib.rs              # tauri builder + SQL migrations + invoke handler
├── tauri.conf.json
└── Cargo.toml
```

## Shortcuts

| Key  | Action                                  |
| ---- | --------------------------------------- |
| ⌘K   | Command palette                         |
| ⌘B   | Toggle unified ↔ split diff             |
| ⌘1   | Dashboard                               |
| ⌘2   | Pull requests                           |
| ⌘3   | Notifications                           |
| ⌘4   | Investigations                          |
| ⌘,   | Settings                                |

## License

Free and open source under the [GNU General Public License v3.0 or later](LICENSE).
