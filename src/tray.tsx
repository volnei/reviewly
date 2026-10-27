import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePrefs } from "@/effect/services/Prefs";
import {
  AtSign,
  GitPullRequest,
  HeartPulse,
  Home,
  Inbox,
  LogOut,
  Settings2,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "@/styles/tray.css";

type TrayStatus = { inbox: number };

const destinations = [
  { route: "/", label: "Home", icon: Home },
  { route: "/inbox", label: "Inbox", icon: Inbox, count: true },
  { route: "/prs", label: "Pull requests", icon: GitPullRequest },
  { route: "/mentions", label: "Mentions", icon: AtSign },
  { route: "/health", label: "Health", icon: HeartPulse },
];

const appearanceArtwork = {
  sunset: "/images/home-sunset.png",
  stellarium: "/images/home-stellarium.png",
  aurora: "/images/home-aurora.png",
  nature: "/images/home-nature.png",
  nebula: "/images/home-nebula.png",
  clouds: "/images/home-clouds.png",
} as const;

function TrayPanel() {
  const [inbox, setInbox] = useState(0);
  const appearance = usePrefs((prefs) => prefs.appearance);
  const artwork =
    appearance in appearanceArtwork
      ? appearanceArtwork[appearance as keyof typeof appearanceArtwork]
      : "/images/home-pixel-night-lowres.png";

  useEffect(() => {
    void invoke<TrayStatus>("tray_status")
      .then((status) => setInbox(status.inbox))
      .catch(() => {});
    const unlisten = listen<number>("tray:status", ({ payload }) => setInbox(payload));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const open = (route?: string) => void invoke("tray_open", { route });

  return (
    <div className="tray-panel" data-ui>
      <header className="tray-head" data-appearance={appearance}>
        <img className="tray-head-art" src={artwork} alt="" draggable={false} />
        <div className="tray-brand">
          <img src="/reviewly-mark.svg" alt="" draggable={false} />
          <div>
            <strong>Reviewly</strong>
            <span>{inbox > 0 ? `${inbox} waiting for you` : "Inbox clear"}</span>
          </div>
        </div>
        <button type="button" className="tray-open" onClick={() => open()}>
          Open
        </button>
      </header>

      <nav aria-label="Quick navigation" className="tray-nav">
        {destinations.map(({ route, label, icon: Icon, count }) => (
          <button key={route} type="button" onClick={() => open(route)}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {count && inbox > 0 ? <b>{inbox}</b> : null}
          </button>
        ))}
      </nav>

      <footer className="tray-foot">
        <button type="button" onClick={() => open("/settings")}>
          <Settings2 aria-hidden="true" />
          <span>Settings</span>
        </button>
        <button type="button" onClick={() => void invoke("tray_quit")}>
          <LogOut aria-hidden="true" />
          <span>Quit</span>
        </button>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TrayPanel />
  </React.StrictMode>,
);
