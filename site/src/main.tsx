import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@calcom/cal-sans-ui/text.css";
import "./styles.css";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const workflow = [
  { name: "Triage", title: "Know what needs you.", body: "Review requests, failing checks, conflicts, and unresolved threads arrive in one queue, already ordered by what is blocking the team.", image: "screenshots/inbox.jpg" },
  { name: "Understand", title: "Read the change first.", body: "See the shape of a pull request, the files it touches, and the context behind it before the diff takes over.", image: "screenshots/pr-overview.jpg" },
  { name: "Coordinate", title: "Leave no review behind.", body: "Teams makes ownership, priority, and the next action visible without turning code review into another project-management ritual.", image: "screenshots/team-queue.jpg" },
] as const;
type Download = { href: string; label: string; platform: "macos" | "windows" | "linux" | "other" };
const releasesUrl = "https://github.com/volnei/reviewly/releases/latest";

function detectedDownload(): Download {
  if (typeof navigator === "undefined") return { href: releasesUrl, label: "Download Reviewly", platform: "other" };
  const agent = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (agent.includes("mac")) return { href: releasesUrl, label: "Download for macOS", platform: "macos" };
  if (agent.includes("win")) return { href: releasesUrl, label: "Download for Windows", platform: "windows" };
  if (agent.includes("linux")) return { href: releasesUrl, label: "Download for Linux", platform: "linux" };
  return { href: releasesUrl, label: "Download Reviewly", platform: "other" };
}
const faqs = [
  ["Does Reviewly send my code to its own AI service?", "No. Hobby mode has no Reviewly AI backend. You choose a local CLI or an OpenAI-compatible endpoint, and Reviewly sends only the context needed for the action you requested."],
  ["Does it work with GitHub Enterprise Server?", "Yes. Connect your company hostname with an existing GitHub CLI login or a personal access token. Reviewly derives the Enterprise REST and GraphQL endpoints automatically."],
  ["What is the difference between Hobby and Teams?", "Hobby is the complete local-first review app for an individual. Teams adds shared review ownership, priority, SLA, and a coordinated queue across an organization."],
  ["Where is my GitHub token stored?", "In the operating system keychain: Keychain on macOS, Credential Manager on Windows, and Secret Service on Linux."],
  ["Which platforms are supported?", "Reviewly ships native installers for macOS, Windows, and Linux. macOS releases are signed and notarized, and the app updates itself."],
] as const;

function Logo({ size = 30 }: { size?: number }) {
  return <img className="logo" src={asset("assets/logo.png")} alt="" width={size} height={size} />;
}
function Arrow() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>;
}
function ProductWindow({ image, label, className = "" }: { image: string; label: string; className?: string }) {
  return <figure className={`product-window ${className}`} data-reveal data-ui>
    <div className="window-controls" aria-hidden="true"><span className="window-close" /><span className="window-minimize" /><span className="window-expand" /></div>
    <img src={asset(image)} alt={label} width="1440" height="900" loading={className.includes("hero") ? "eager" : "lazy"} />
  </figure>;
}

function Site() {
  const [installMethod, setInstallMethod] = useState<"download" | "homebrew">("homebrew");
  const [copied, setCopied] = useState(false);
  const [download, setDownload] = useState<Download>(detectedDownload);

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.setAttribute("data-visible", "true");
    }), { threshold: 0.1 });
    items.forEach((item) => observer.observe(item));
    const fallback = window.setTimeout(() => items.forEach((item) => item.setAttribute("data-visible", "true")), 1200);
    fetch("https://api.github.com/repos/volnei/reviewly/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((release: { assets?: Array<{ name: string; browser_download_url: string }> }) => {
        const patterns = {
          macos: /macos\.dmg$/i,
          windows: /windows-setup\.exe$/i,
          linux: /linux\.AppImage$/i,
          other: /$^/,
        };
        const selected = release.assets?.find((item) => patterns[download.platform].test(item.name));
        if (selected) setDownload((current) => ({ ...current, href: selected.browser_download_url }));
      })
      .catch(() => undefined);
    return () => { window.clearTimeout(fallback); observer.disconnect(); document.documentElement.classList.remove("motion-ready"); };
  }, [download.platform]);

  return <>
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Reviewly home"><Logo /><span>Reviewly</span></a>
      <nav aria-label="Main navigation"><a href="#product">Product</a><a href="#teams">Teams</a><a href="#pricing">Pricing</a><a className="nav-action" href={download.href}>Download</a></nav>
    </header>
    <main>
      <section className="hero" id="top">
        <div className="hero-copy" data-reveal>
          <h1>Ship code,<br />not noise.</h1>
          <div className="hero-support">
            <div><p>Reviewly is the open-source pull request workspace for developers and teams. Free forever for individuals.</p><a className="hero-source" href="https://github.com/volnei/reviewly">Open source on GitHub <Arrow /></a></div>
            <div className="hero-download"><a className="button button-primary" href={download.href}>{download.label} <Arrow /></a><a href={releasesUrl}>Other platforms</a></div>
          </div>
        </div>
        <ProductWindow image="screenshots/inbox.jpg" label="Reviewly — Inbox" className="hero-window" />
      </section>

      <section className="manifesto" aria-labelledby="manifesto-title">
        <div className="manifesto-heading" data-reveal><h2 id="manifesto-title">A calmer review.</h2></div>
        <div className="principles" data-reveal>
          <article><h3>Purpose-built</h3><p>Not another GitHub dashboard. Every surface is designed around the next review decision.</p></article>
          <article><h3>Private by default</h3><p>Your GitHub credentials stay in your operating system keychain. AI remains optional.</p></article>
          <article><h3>Native and fast</h3><p>A desktop workspace that keeps context close and browser noise out of the way.</p></article>
        </div>
        <figure className="manifesto-detail" data-reveal data-ui><img src={asset("screenshots/pr-overview.jpg")} alt="Reviewly showing the structure and risk of a pull request" width="1440" height="900" loading="lazy" /></figure>
      </section>

      <section className="showcase" id="product" aria-labelledby="showcase-title">
        <div className="section-intro" data-reveal><div><h2 id="showcase-title">See the whole change.</h2></div><p>Reviewly brings status, risk, files, checks, and open threads into one readable overview, so the diff starts with context.</p></div>
        <ProductWindow image="screenshots/pr-overview.jpg" label="Reviewly — Pull request overview" />
      </section>

      <section className="workflow" aria-labelledby="workflow-title">
        <div className="section-intro" data-reveal><div><h2 id="workflow-title">From request to decision.</h2></div><p>The work changes as a pull request moves forward. Reviewly keeps the next action legible at every state.</p></div>
        <div className="workflow-list" data-reveal>
          {workflow.map((item) => <div className="workflow-item" key={item.name}><span className="workflow-name">{item.name}</span><p className="workflow-title">{item.title}</p><p className="workflow-body">{item.body}</p></div>)}
        </div>
      </section>

      <section className="teams" id="teams">
        <div className="teams-copy" data-reveal><h2>Ownership, shared.</h2><p>One coordinated queue above the local-first app. Claim a review, set priority, and see what is at risk before a pull request stalls.</p><a className="text-action" href="#pricing">Explore Teams <Arrow /></a></div>
        <ProductWindow image="screenshots/team-queue.jpg" label="Reviewly — Team queue" className="teams-window" />
      </section>

      <section className="install" aria-labelledby="install-title">
        <div className="install-copy" data-reveal><h2 id="install-title">Install it your way.</h2><p>Use the signed installer or keep Reviewly updated with Homebrew.</p></div>
        <div className="install-view" data-reveal>
          <div className="install-tabs" role="tablist" aria-label="Installation method"><button role="tab" aria-selected={installMethod === "homebrew"} onClick={() => setInstallMethod("homebrew")}>Homebrew</button><button role="tab" aria-selected={installMethod === "download"} onClick={() => setInstallMethod("download")}>Direct download</button></div>
          {installMethod === "homebrew" ? <div className="brew-command"><code><span>$</span> brew install --cask volnei/tap/reviewly</code><button onClick={async () => { await navigator.clipboard.writeText("brew install --cask volnei/tap/reviewly"); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>{copied ? "Copied" : "Copy"}</button></div> : <div className="direct-download"><span>{download.label}</span><a href={download.href}>Download now <Arrow /></a></div>}
        </div>
      </section>

      <section className="pricing" id="pricing" aria-labelledby="pricing-title">
        <div className="pricing-heading" data-reveal><h2 id="pricing-title">Free to start.<br />Built to scale.</h2><p>Reviewly is open source. The individual app stays free forever; Teams adds the coordination layer companies need.</p></div>
        <div className="plans" data-reveal>
          <article className="plan hobby-plan"><div><h3>Hobby</h3><p className="plan-price">$0 <small>forever</small></p></div><p>For developers who want a faster, calmer review workflow.</p><ul><li>Complete native review workspace</li><li>Unlimited repositories</li><li>Private, optional AI</li><li>GitHub Enterprise support</li><li>Open-source GPL-3.0</li></ul><a className="button button-secondary" href={download.href}>{download.label} <Arrow /></a></article>
          <article className="plan teams-plan"><div><h3>Teams</h3><p className="plan-price">$8 <small>per member / month</small></p></div><p>For teams that need shared ownership and a review queue that never stalls.</p><ul><li>Everything in Hobby</li><li>Shared team review queue</li><li>Owners, priority, and SLA</li><li>GitHub App synchronization</li><li>Centralized billing</li></ul><a className="button button-primary" href="https://github.com/volnei/reviewly">Set up your team <Arrow /></a></article>
        </div>
      </section>

      <section className="faq" aria-labelledby="faq-title">
        <div data-reveal><h2 id="faq-title">Straight answers.</h2></div>
        <div className="faq-list" data-reveal>{faqs.map(([question, answer], index) => <details name="faq" key={question} open={index === 0}><summary>{question}<span aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="closing"><div className="closing-copy" data-reveal><Logo size={54} /><h2>Review what matters.</h2><p>Open source. Free forever for individuals.</p><a className="button button-primary" href={download.href}>{download.label} <Arrow /></a></div></section>
    </main>
    <footer><a className="brand" href="#top"><Logo size={24} /><span>Reviewly</span></a><div><a href="https://github.com/volnei/reviewly">GitHub</a><a href="https://github.com/volnei/reviewly/releases">Releases</a><a href="https://github.com/volnei/reviewly/blob/main/LICENSE">GPL-3.0</a></div><span>© {new Date().getFullYear()} Reviewly</span></footer>
  </>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Site /></React.StrictMode>);
