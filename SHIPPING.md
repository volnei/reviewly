# Shipping Reviewly

What it takes to go from "runs on my machine" to "a build people can install and update."
The app code is ready; the remaining work is **credentials + infra that only you can do**
(Apple cert, an update-signing key, hosting). This is the runway.

Current: `version 0.1.0`, `identifier dev.volnei.reviewly`, target macOS (Tauri 2).

Reviewly is free and open source — there is no paywall, license, or account.

---

## ✅ Done in-app (no action needed)
- **First-run wizard** — `/onboarding`: Connect GitHub → pick repos → Start.
- **Auto-update plumbed** — updater + process plugins, config (pubkey + endpoint),
  launch check + ⌘K "Check for updates" (see §2 for the 2 remaining ops steps).
- **macOS bundle** — `minimumSystemVersion` set; signing is env-driven (see §1).
- **Local-first**: GitHub token in the OS keychain; AI runs via your local CLI / endpoint.

---

## 1. Code signing + notarization (macOS)
Unsigned `.app`s get the Gatekeeper "damaged / unidentified developer" wall. To avoid it:

1. Apple **Developer ID Application** certificate (paid Apple Developer account).
2. Set env (e.g. in CI secrets — never commit):
   `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_ID`, `APPLE_PASSWORD` (app-specific pw), `APPLE_TEAM_ID`.
3. No config change needed — `bundle.macOS.minimumSystemVersion` is already set, and Tauri picks
   up the identity from `APPLE_SIGNING_IDENTITY` automatically (only add `bundle.macOS.entitlements`
   if a future capability requires it).
4. `bun tauri build` — Tauri signs and notarizes when those env vars are present.

> ⚠️ I can't enter your Apple cert / app-specific password.

## 2. Auto-update (`tauri-plugin-updater`) — ✅ WIRED, 2 steps left
Already done in-app: plugins (`tauri-plugin-updater` + `tauri-plugin-process`) installed &
registered, capabilities added, `plugins.updater` configured (pubkey + GitHub Releases endpoint),
`createUpdaterArtifacts: true`, **silent check on launch** + **"Check for updates" in ⌘K** (toast →
Restart & install). A **dev signing key** was generated at `~/.reviewly/updater.key(.pub)` and its
public key is in `tauri.conf.json`.

You still need to:
1. **Own the signing key.** The generated dev key has **no password** — for production, regenerate
   with one (`bun tauri signer generate -p '<pw>' -w ~/.reviewly/updater.key -f`), put the new
   `.pub` into `tauri.conf.json → plugins.updater.pubkey`, and in CI set
   `TAURI_SIGNING_PRIVATE_KEY` (file contents) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   Keep the private key secret — never commit it.
2. **Publish releases.** Each `bun tauri build` (with the signing env set) emits the signed
   `.app.tar.gz` + `.sig` + a `latest.json`; upload all three to a **GitHub Release** so the
   configured endpoint (`github.com/volnei/reviewly/releases/latest/download/latest.json`) resolves.
   Until the first release exists, the launch check just 404s silently — harmless.

## 3. Build & distribute
- `bun tauri build` → `src-tauri/target/release/bundle/dmg/Reviewly_<ver>_aarch64.dmg`.
- Bump `version` in `tauri.conf.json` per release (drives the updater).
- Host the `.dmg` + `latest.json` on GitHub Releases; link the `.dmg` from a tiny landing page.

---

## Suggested order
1. **Signing + notarization** → a `.dmg` that opens cleanly (do this first; everything else builds on a trusted app).
2. **Auto-update** → ship fixes without users re-downloading.
3. Landing page + first public build.

Things marked ⚠️ need your credentials. Everything else (app wiring, the updater UI) I can finish
once the secrets/keys exist.
