/**
 * The Mac App Store edition (`bun run tauri:appstore`) runs in the App Sandbox,
 * where spawned CLIs (git, gh, claude, codex, gemini) can't see the user's home
 * and arbitrary repo folders aren't readable. It keeps everything that talks to
 * GitHub and hides what needs this machine: local repositories, CLI-backed AI,
 * gh sign-in, the self-updater and launch at login. Fixed at build time.
 */
export const APP_STORE = import.meta.env.VITE_REVIEWLY_EDITION === "appstore";
