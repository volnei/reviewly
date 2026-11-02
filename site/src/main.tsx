import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

const stages = [
  {
    label: "Find",
    title: "See what needs you.",
    body: "Review requests, failing checks, open threads and merge-ready work arrive in one ordered inbox.",
    image: "screenshots/inbox.jpg",
  },
  {
    label: "Understand",
    title: "Read the change first.",
    body: "Reviewly maps the shape of a pull request and puts the risky paths, checks and unresolved context first.",
    image: "screenshots/pr-overview.jpg",
  },
  {
    label: "Review",
    title: "Keep decisions attached.",
    body: "Write inline comments, answer threads and submit one coherent review without losing your place.",
    image: "screenshots/pr-overview.jpg",
  },
  {
    label: "Coordinate",
    title: "Make ownership visible.",
    body: "Teams adds a shared queue, clear owners, priority and SLA without turning review into project management.",
    image: "screenshots/team-queue.jpg",
  },
] as const;

const capabilities = [
  {
    name: "A real review inbox",
    fact: "Requested, blocked and ready, already sorted.",
    image: "screenshots/inbox.jpg",
    className: "capability capability-wide",
  },
  {
    name: "Change briefing",
    fact: "A map of the PR before the first line of diff.",
    image: "screenshots/pr-overview.jpg",
    className: "capability capability-tall",
  },
  {
    name: "Private AI",
    fact: "Claude, Codex, Gemini or your own endpoint.",
    image: "screenshots/pr-overview.jpg",
    className: "capability capability-square capability-focus-ai",
  },
  {
    name: "Shared ownership",
    fact: "One owner, one next action, no review limbo.",
    image: "screenshots/team-queue.jpg",
    className: "capability capability-wide capability-focus-team",
  },
] as const;

const faqs = [
  [
    "Does Reviewly send my code to its own AI service?",
    "No. Hobby mode has no Reviewly AI backend. You choose a local CLI or an OpenAI-compatible endpoint, and Reviewly sends only the context needed for the action you requested.",
  ],
  [
    "Does it work with GitHub Enterprise Server?",
    "Yes. Connect your company hostname with an existing GitHub CLI login or a personal access token. Reviewly derives the Enterprise REST and GraphQL endpoints automatically.",
  ],
  [
    "What is the difference between Hobby and Teams?",
    "Hobby is the complete local-first review app for an individual. Teams adds shared review ownership, priority, SLA and a coordinated queue across an organization.",
  ],
  [
    "Where is my GitHub token stored?",
    "In the operating system keychain: Keychain on macOS, Credential Manager on Windows and Secret Service on Linux. It is never stored as plaintext in Reviewly's database.",
  ],
  [
    "Which platforms are supported?",
    "Reviewly ships native installers for macOS, Windows and Linux. macOS releases are signed and notarized, and the app updates itself.",
  ],
  [
    "Can I use Reviewly without AI?",
    "Absolutely. The inbox, diff reader, review composer, checks, threads, local repository tools and notifications all work without an AI provider.",
  ],
] as const;

function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "mark mark-compact" : "mark"} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function Site() {
  const [mode, setMode] = useState<"local" | "teams">("local");
  const [stageIndex, setStageIndex] = useState(1);
  const [plan, setPlan] = useState<"hobby" | "teams">("teams");
  const stage = stages[stageIndex];

  const modeCopy = useMemo(
    () =>
      mode === "local"
        ? {
            title: "Review day, in order.",
            body: "A fast local inbox that knows what is waiting on you and what can wait.",
            image: "screenshots/inbox.jpg",
          }
        : {
            title: "Ownership, made obvious.",
            body: "A shared queue makes ownership, priority and the next action obvious to the whole team.",
            image: "screenshots/team-queue.jpg",
          },
    [mode],
  );

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.dataset.visible = "true";
        }
      },
      { threshold: 0.12 },
    );
    items.forEach((item) => observer.observe(item));
    const fallback = window.setTimeout(() => {
      items.forEach((item) => {
        item.dataset.visible = "true";
      });
    }, 1400);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Reviewly home">
          <Mark compact />
          <span>Reviewly</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#teams">Teams</a>
          <a href="#pricing">Pricing</a>
          <a className="header-github" href="https://github.com/volnei/reviewly">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className="hero" id="top">
          <div className="hero-copy" data-reveal>
            <h1>Pull requests. Focused.</h1>
            <p>
              One focused desktop workspace for the changes that need you, with private AI and
              optional team coordination.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="https://github.com/volnei/reviewly/releases">
                Download Reviewly <Arrow />
              </a>
              <a className="text-link" href="https://github.com/volnei/reviewly">
                View source
              </a>
            </div>
            <span className="hero-note">Free for individuals · macOS, Windows and Linux</span>
          </div>

          <div className="hero-motif" aria-hidden="true">
            <span className="slab slab-one" />
            <span className="slab slab-two">
              <img src={asset("screenshots/pr-overview.jpg")} alt="" width="1440" height="900" />
            </span>
            <span className="slab slab-three" />
          </div>
        </section>

        <section className={`mode-showcase mode-${mode}`} id="product">
          <div className="section-copy" data-reveal>
            <h2>{modeCopy.title}</h2>
            <p>{modeCopy.body}</p>
            <div className="mode-switch" role="group" aria-label="Choose product mode">
              <button aria-pressed={mode === "local"} onClick={() => setMode("local")}>
                Local
              </button>
              <button aria-pressed={mode === "teams"} onClick={() => setMode("teams")}>
                Teams
              </button>
            </div>
          </div>
          <div className="showcase-stack" data-ui data-reveal>
            <div className="screenshot-frame screenshot-frame-back" />
            <figure className="screenshot-frame">
              <img
                key={modeCopy.image}
                src={asset(modeCopy.image)}
                alt={mode === "local" ? "Reviewly review inbox" : "Reviewly Teams shared queue"}
                width="1440"
                height="900"
              />
            </figure>
          </div>
        </section>

        <section className="capabilities-section" aria-labelledby="capabilities-title">
          <div className="capabilities-intro" data-reveal>
            <h2 id="capabilities-title">Built for review.</h2>
            <p>
              Reviewly keeps the change, its context and the decision in one place. The browser can
              go back to being a browser.
            </p>
          </div>
          <div className="capability-grid">
            {capabilities.map((capability) => (
              <article className={capability.className} key={capability.name} data-reveal>
                <figure>
                  <img
                    src={asset(capability.image)}
                    alt=""
                    width="1440"
                    height="900"
                    loading="lazy"
                  />
                </figure>
                <h3>{capability.name}</h3>
                <p>{capability.fact}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="stages" aria-labelledby="stage-title">
          <div className="stage-copy" data-reveal>
            <h2 id="stage-title">{stage.title}</h2>
            <p>{stage.body}</p>
          </div>
          <div className="stage-product" data-ui data-reveal>
            <img
              key={stage.image}
              src={asset(stage.image)}
              alt={`Reviewly ${stage.label.toLowerCase()} stage`}
              width="1440"
              height="900"
              loading="lazy"
            />
          </div>
          <div className="stage-control">
            <input
              aria-label="Review workflow stage"
              type="range"
              min="0"
              max={stages.length - 1}
              value={stageIndex}
              onChange={(event) => setStageIndex(Number(event.target.value))}
            />
            <div className="stage-labels" aria-hidden="true">
              {stages.map((item, index) => (
                <span className={index === stageIndex ? "active" : ""} key={item.label}>
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="teams-band" id="teams">
          <div className="teams-statement" data-reveal>
            <h2>Shared work. Clear ownership.</h2>
            <p>
              Teams adds a coordinated queue on top of the local-first app: reviewers can claim work,
              set priority and see what is at risk before a pull request stalls.
            </p>
            <a className="button button-light" href="#pricing">
              Explore Teams <Arrow />
            </a>
          </div>
          <figure className="teams-image" data-reveal>
            <img
              src={asset("screenshots/team-queue.jpg")}
              alt="Shared review queue in Reviewly Teams"
              width="1440"
              height="900"
              loading="lazy"
            />
          </figure>
        </section>

        <section className="pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="plan-list" data-reveal>
            <h2 id="pricing-title" className="sr-only">
              Pricing
            </h2>
            <button className={plan === "hobby" ? "selected" : ""} onClick={() => setPlan("hobby")}>
              Hobby
            </button>
            <button className={plan === "teams" ? "selected" : ""} onClick={() => setPlan("teams")}>
              Teams
            </button>
          </div>
          <div className="price-stage" data-reveal>
            {plan === "hobby" ? (
              <>
                <div className="price">$0</div>
                <p>
                  The complete local-first review workspace for individual developers. No account,
                  telemetry or subscription required.
                </p>
                <a className="button button-primary" href="https://github.com/volnei/reviewly/releases">
                  Download free <Arrow />
                </a>
              </>
            ) : (
              <>
                <div className="price">
                  $8 <small>per user / month</small>
                </div>
                <p>
                  Everything in Hobby, plus shared ownership, team queues, priority and SLA across
                  your GitHub organization.
                </p>
                <a className="button button-primary" href="https://github.com/volnei/reviewly">
                  Get Reviewly Teams <Arrow />
                </a>
              </>
            )}
          </div>
        </section>

        <section className="faq" aria-labelledby="faq-title">
          <h2 id="faq-title" data-reveal>
            Straight answers.
          </h2>
          <div className="faq-list" data-reveal>
            {faqs.map(([question, answer], index) => (
              <details name="faq" key={question} open={index === 0}>
                <summary>
                  {question}
                  <span aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing">
          <div data-reveal>
            <h2>Review belongs in Reviewly.</h2>
            <a className="closing-action" href="https://github.com/volnei/reviewly/releases">
              Download it <Arrow />
            </a>
          </div>
          <div className="closing-mark" aria-hidden="true">
            <Mark />
          </div>
          <p>Native, local-first and open source.</p>
        </section>
      </main>

      <footer>
        <a className="footer-brand" href="#top">
          <Mark />
          <span>Reviewly</span>
        </a>
        <div>
          <a href="https://github.com/volnei/reviewly">GitHub</a>
          <a href="https://github.com/volnei/reviewly/releases">Releases</a>
          <a href="https://github.com/volnei/reviewly/blob/main/LICENSE">GPL-3.0</a>
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Site />
  </React.StrictMode>,
);
