import { Context, Effect, Layer, Schema } from "effect";
import { Tauri } from "../Tauri";
import type { AppError } from "../errors";
import * as S from "../schema";

type Fx<A> = Effect.Effect<A, AppError>;

/** The few settings the Rust side needs to know about (the poller, the tray, the OS). */
export class AppSettings extends Context.Service<
  AppSettings,
  {
    readonly setWatchedRepos: (repos: ReadonlyArray<string>) => Fx<void>;
    readonly setPollInterval: (minutes: number) => Fx<void>;
    readonly setNotificationsEnabled: (enabled: boolean) => Fx<void>;
    readonly setNotificationReasons: (reasons: ReadonlyArray<string>) => Fx<void>;
    readonly setLaunchAtLogin: (enabled: boolean) => Fx<void>;
    readonly getLaunchAtLogin: Fx<boolean>;
    readonly setStartInTray: (enabled: boolean) => Fx<void>;
    readonly setTrayTitle: (title: string) => Fx<void>;
    readonly aiAvailable: (provider: string) => Fx<boolean>;
    /** The Dock icon, white or black (macOS). */
    readonly setAppIcon: (variant: "white" | "black") => Fx<void>;
  }
>()("reviewly/AppSettings") {}

export const AppSettingsLive = Layer.effect(
  AppSettings,
  Effect.gen(function* () {
    const t = yield* Tauri;
    const unit = (cmd: string, args: Record<string, unknown>) =>
      t.invoke(cmd, args, S.Unit).pipe(Effect.asVoid);
    return {
      setWatchedRepos: (repos) => unit("set_watched_repos", { repos }),
      setPollInterval: (minutes) => unit("set_poll_interval", { secs: Math.round(minutes * 60) }),
      setNotificationsEnabled: (enabled) => unit("set_notifications_enabled", { enabled }),
      setNotificationReasons: (reasons) => unit("set_notification_reasons", { reasons }),
      setLaunchAtLogin: (enabled) => unit("set_launch_at_login", { enabled }),
      getLaunchAtLogin: t.invoke("get_launch_at_login", {}, Schema.Boolean),
      setStartInTray: (enabled) => unit("set_start_in_tray", { enabled }),
      setTrayTitle: (title) => unit("tray_set_title", { title }),
      aiAvailable: (provider) => t.invoke("ai_available", { provider }, Schema.Boolean),
      setAppIcon: (variant) => unit("set_app_icon", { variant }),
    };
  }),
);
