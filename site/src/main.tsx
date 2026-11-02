import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@calcom/cal-sans-ui/text.css";
import "./styles.css";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

const workflow = [
  { name: "Triage", title: "Know what needs you.", body: "Review requests, failing checks and unresolved threads arrive in one queue, already ordered by what is blocking the team.", image: "screenshots/inbox.jpg" },
  { name: "Understand", title: "Read the change first.", body: "Reviewly gives you the shape of the pull request, the risky files and the context behind the change before the diff takes over.", image: "screenshots/pr-overview.jpg" },
  { name: "Coordinate", title: "Leave no review behind.", body: "Teams makes the owner, priority and next action visible without turning code review into another project-management ritual.", image: "screenshots/team-queue.jpg" },
] as const;

const faqs = [
  ["Does Reviewly send my code to its own AI service?", "No. Hobby mode has no Reviewly AI backend. You choose a local CLI or an OpenAI-compatible endpoint, and Reviewly sends only the context needed for the action you requested."],
  ["Does it work with GitHub Enterprise Server?", "Yes. Connect your company hostname with an existing GitHub CLI login or a personal access token. Reviewly derives the Enterprise REST and GraphQL endpoints automatically."],
  ["What is the difference between Hobby and Teams?", "Hobby is the complete local-first review app for an individual. Teams adds shared review ownership, priority, SLA and a coordinated queue across an organization."],
  ["Where is my GitHub token stored?", "In the operating system keychain: Keychain on macOS, Credential Manager on Windows and Secret Service on Linux. It is never stored as plaintext in Reviewly's database."],
  ["Which platforms are supported?", "Reviewly ships native installers for macOS, Windows and Linux. macOS releases are signed and notarized, and the app updates itself."],
  ["Can I use Reviewly without AI?", "Absolutely. The inbox, diff reader, review composer, checks, threads, local repository tools and notifications all work without an AI provider."],
] as const;

function Logo({ size = 34 }: { size?: number }) {
  return <img className="logo" src={asset("assets/logo.png")} alt="" width={size} height={size} />;
}

function Arrow() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>;
}

function Site() {
  const [workflowIndex, setWorkflowIndex] = useState(0);
  const [plan, setPlan] = useState<"hobby" | "teams">("teams");
  const [features, setFeatures] = useState([true, true, false, true]);
  const [installMethod, setInstallMethod] = useState<"download" | "homebrew">("homebrew");
  const [copied, setCopied] = useState(false);
  const activeWorkflow = workflow[workflowIndex];

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.setAttribute("data-visible", "true");
    }), { threshold: 0.12 });
    items.forEach((item) => observer.observe(item));
    const fallback = window.setTimeout(() => items.forEach((item) => item.setAttribute("data-visible", "true")), 1400);
    return () => { window.clearTimeout(fallback); observer.disconnect(); document.documentElement.classList.remove("motion-ready"); };
  }, []);

  const toggleFeature = (index: number) => setFeatures((current) => current.map((value, item) => item === index ? !value : value));

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Reviewly home"><Logo /><span>Reviewly</span></a>
        <nav aria-label="Main navigation">
          <a href="#product">Product</a><a href="#teams">Teams</a><a href="#pricing">Pricing</a>
          <a className="nav-action" href="https://github.com/volnei/reviewly/releases">Download</a>
        </nav>
      </header>

      <main>
        <section className="hero" id="top">
          <div className="hero-copy" data-reveal>
            <h1>Review pull requests.</h1>
            <p>A native pull request workspace that turns GitHub noise into one calm, ordered review queue — with private AI when you want it.</p>
            <a className="button button-primary" href="https://github.com/volnei/reviewly/releases">Download Reviewly <Arrow /></a>
            <span className="support-note">Free for individuals · macOS, Windows and Linux</span>
          </div>

          <figure className="hero-stage" data-reveal data-ui>
            <img className="hero-fragment" src={asset("screenshots/inbox.jpg")} alt="The real Reviewly pull request inbox" width="1440" height="900" />
          </figure>
        </section>

        <section className="install" aria-labelledby="install-title">
          <div className="install-copy" data-reveal>
            <h2 id="install-title">Install it your way.</h2>
            <p>Use the signed installer or keep Reviewly updated with Homebrew.</p>
          </div>
          <div className="install-view" data-reveal data-ui>
            <div className="install-tabs" role="tablist" aria-label="Installation method">
              <button role="tab" aria-selected={installMethod === "homebrew"} onClick={() => setInstallMethod("homebrew")}>Homebrew</button>
              <button role="tab" aria-selected={installMethod === "download"} onClick={() => setInstallMethod("download")}>Direct download</button>
            </div>
            {installMethod === "homebrew" ? (
              <div className="brew-command">
                <code>brew install --cask volnei/tap/reviewly</code>
                <button onClick={async () => { await navigator.clipboard.writeText("brew install --cask volnei/tap/reviewly"); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>{copied ? "Copied" : "Copy"}</button>
              </div>
            ) : (
              <div className="direct-download"><span>macOS, Windows and Linux installers</span><a href="https://github.com/volnei/reviewly/releases">Open releases <Arrow /></a></div>
            )}
          </div>
        </section>

        <section className="showcase" id="product" aria-labelledby="showcase-title">
          <div className="section-intro" data-reveal>
            <h2 id="showcase-title">Every review, one place.</h2>
            <p>A review request changes shape as work moves forward. Reviewly keeps the next action legible at every state.</p>
          </div>
          <figure className="showcase-image" data-reveal data-ui>
            <img src={asset("screenshots/pr-overview.jpg")} alt="A real pull request overview in Reviewly" width="1440" height="900" loading="lazy" />
          </figure>
        </section>

        <section className="feature-bands" aria-label="Reviewly capabilities">
          {[
            ["Order my review queue", "12 pull requests triaged by urgency"],
            ["Brief every change first", "8 files mapped to 3 areas of risk"],
            ["Keep AI private and optional", "No Reviewly AI backend in Hobby mode"],
            ["Make ownership visible", "4 reviewers across one shared queue"],
          ].map(([label, result], index) => (
            <div className={features[index] ? "feature-band enabled" : "feature-band"} key={label} data-reveal>
              <div><p>{label}</p>{features[index] && <span>{result}</span>}</div>
              <button className="feature-toggle" aria-label={`${features[index] ? "Disable" : "Enable"} ${label}`} aria-pressed={features[index]} onClick={() => toggleFeature(index)}><span /></button>
            </div>
          ))}
        </section>

        <section className="workflow" aria-labelledby="workflow-title">
          <div className="workflow-copy" data-reveal>
            <h2 id="workflow-title">Request to decision.</h2>
            <div className="workflow-nav" role="tablist" aria-label="Review workflow">
              {workflow.map((item, index) => (
                <button role="tab" aria-selected={workflowIndex === index} onClick={() => setWorkflowIndex(index)} key={item.name}><strong>{item.name}</strong><span>{item.title}</span></button>
              ))}
            </div>
            <p>{activeWorkflow.body}</p>
          </div>
          <figure className="workflow-image" data-reveal data-ui><img key={activeWorkflow.image} src={asset(activeWorkflow.image)} alt={activeWorkflow.title} width="1440" height="900" /></figure>
        </section>

        <section className="teams" id="teams">
          <div className="teams-copy" data-reveal>
            <h2>Ownership, shared.</h2>
            <p>Reviewly Teams adds one coordinated queue above the local-first app. Claim a review, set priority and see what is at risk before a pull request stalls.</p>
            <a className="text-action" href="#pricing">See Teams pricing <Arrow /></a>
          </div>
          <figure className="teams-image" data-reveal data-ui><img src={asset("screenshots/team-queue.jpg")} alt="Reviewly Teams shared review queue" width="1440" height="900" loading="lazy" /></figure>
        </section>

        <section className="pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="plan-list" data-reveal><h2 id="pricing-title" className="sr-only">Pricing</h2><button className={plan === "hobby" ? "selected" : ""} onClick={() => setPlan("hobby")}>Hobby</button><button className={plan === "teams" ? "selected" : ""} onClick={() => setPlan("teams")}>Teams</button></div>
          <div className="price-stage" data-reveal>
            {plan === "hobby" ? <><div className="price">$0</div><p>The complete local-first review workspace. No account, telemetry or subscription required.</p><a className="button button-primary" href="https://github.com/volnei/reviewly/releases">Download free <Arrow /></a></> : <><div className="price">$8 <small>per user / month</small></div><p>Everything in Hobby, plus shared ownership, team queues, priority and SLA across your GitHub organization.</p><a className="button button-primary" href="https://github.com/volnei/reviewly">Set up your team <Arrow /></a></>}
          </div>
        </section>

        <section className="faq" aria-labelledby="faq-title">
          <h2 id="faq-title" data-reveal>Straight answers.</h2>
          <div className="faq-list" data-reveal>{faqs.map(([question, answer], index) => <details name="faq" key={question} open={index === 0}><summary>{question}<span aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="closing">
          <div className="closing-copy" data-reveal><Logo size={56} /><h2>Review, focused.</h2><p>Download Reviewly and open the pull request that actually needs you.</p><a className="button button-inverse" href="https://github.com/volnei/reviewly/releases">Download Reviewly <Arrow /></a></div>
          <figure className="closing-image" data-reveal data-ui><img src={asset("screenshots/inbox.jpg")} alt="The Reviewly inbox" width="1440" height="900" loading="lazy" /></figure>
        </section>
      </main>

      <footer><span>Reviewly · Pull request workspace</span><div><a href="https://github.com/volnei/reviewly">GitHub</a><a href="https://github.com/volnei/reviewly/releases">Releases</a><a href="https://github.com/volnei/reviewly/blob/main/LICENSE">GPL-3.0</a></div><span>© {new Date().getFullYear()}</span></footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Site /></React.StrictMode>);
