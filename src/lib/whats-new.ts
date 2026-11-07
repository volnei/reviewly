interface WhatsNewItem {
  title: string;
  detail?: string;
}

export interface WhatsNewEntry {
  version: string;
  /** ISO date the version shipped, e.g. "2026-07-05". */
  date?: string;
  items: WhatsNewItem[];
}

/**
 * Release highlights, NEWEST FIRST. Shown in-app after an update (and from
 * About → What's new). Keep in sync with the GitHub release notes; add a new
 * entry at the top for each release. English only (matches the release notes).
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "1.1.5",
    date: "2026-11-07",
    items: [
      {
        title: "Fast lane, tuned for each repository",
        detail:
          "Start from one workspace policy, then give individual repositories their own trusted authors, limits, safety checks, paths, and labels. Repositories can return to the shared default at any time.",
      },
      {
        title: "Repository access stays current",
        detail:
          "Only repositories selected in the GitHub App can use a Fast lane override, and stale policies are removed when a repository leaves the installation.",
      },
    ],
  },
  {
    version: "1.1.4",
    date: "2026-11-07",
    items: [
      {
        title: "OpenSpec becomes the product delivery system",
        detail:
          "Turn an idea into a grounded OpenSpec proposal, inspect system specs, track scenarios and implementation tasks, attach stacked pull requests, revise active changes, and follow verified delivery progress per project.",
      },
      {
        title: "Live CI, without leaving the pull request",
        detail:
          "Watch checks move through queued, running, passed, failed, skipped, and cancelled states, with grouped shards, durations, annotations, and clearer failure evidence.",
      },
      {
        title: "Auto-fix review feedback, CI, and conflicts",
        detail:
          "Use a local AI provider to inspect unresolved review comments, failing checks, and merge conflicts together, apply the fixes in a clean local clone, and validate the result without committing or pushing.",
      },
      {
        title: "Environments, from local to shared",
        detail:
          "Keep variables and reusable commands per project, preload values from .env.example, .env, or .env.local, and share encrypted environments with your team.",
      },
      {
        title: "Review skills that follow the code",
        detail:
          "Give each project focused review playbooks for security, migrations, API compatibility, accessibility, or your own standards; Reviewly selects them from the repository and changed paths.",
      },
      {
        title: "More than one team",
        detail:
          "Connect multiple Teams workspaces and switch the Review queue, Fast lane, integrations, and shared environments without reconnecting your account.",
      },
      {
        title: "Close a pull request from the conversation",
        detail:
          "Close an open pull request beside the main comment composer, with confirmation and a quick Reopen action.",
      },
      {
        title: "Return to the work you came from",
        detail:
          "Opening a pull request from Inbox, Pull requests, Review queue, Fast lane, Health, Mentions, History, or Merge Lab now takes you back to that exact workflow.",
      },
      {
        title: "Updates are ready when you are",
        detail:
          "When a desktop update is available, the title bar exposes a direct download and install action instead of hiding it behind Settings.",
      },
      {
        title: "Safer shared commands",
        detail:
          "Reviewly confirms team commands before running, detects changes made after you loaded them, keeps working directories inside the selected repository, and handles large Unicode output safely.",
      },
      {
        title: "Teams stays truthful",
        detail:
          "Closed pull requests leave the shared queue reliably, transient refresh failures no longer erase a valid connection, and paid themes disappear after a downgrade.",
      },
    ],
  },
  {
    version: "1.1.2",
    date: "2026-11-03",
    items: [
      {
        title: "Teams access tightened",
        detail:
          "Fast lane, integrations, organization pages, repository access, and complimentary plans now share the same server-backed access rules.",
      },
      {
        title: "Repository-aware Fast lane",
        detail:
          "Fast lane only appears for repositories connected to the selected Teams workspace and explains when the current project is not available there.",
      },
      {
        title: "A steadier desktop",
        detail:
          "The navigation rail scrolls correctly, duplicate window branding is gone, and release dependencies were aligned and hardened.",
      },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-11-02",
    items: [
      {
        title: "Teams connection repaired",
        detail:
          "Organization responses decode correctly again, so a completed browser connection reaches the desktop without getting stuck on Set up your team.",
      },
      {
        title: "Clearer setup and native chrome",
        detail:
          "The Teams callout now explains the handoff before opening the browser, and macOS traffic lights align with the title bar.",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-02",
    items: [
      {
        title: "Reviewly Teams",
        detail:
          "A shared review queue adds visible ownership, next actions, priority, and SLA across the team, with per-seat billing and complimentary access support.",
      },
      {
        title: "Fast lane",
        detail:
          "Teams can define which safe changes move out of the review queue using authors, bots, CI, size, labels, paths, drafts, conflicts, threads, and changes requested.",
      },
      {
        title: "GitLab and Slack",
        detail:
          "Bring GitLab merge requests into the team workflow and connect Slack for assignments, reminders, and review activity.",
      },
      {
        title: "Obsidian",
        detail:
          "Teams members get a dedicated dark workspace atmosphere across the app and Home artwork.",
      },
      {
        title: "Safer AI CLIs",
        detail:
          "Antigravity and Gemini reviews run with read-only sandbox permissions, and Antigravity joins the available local AI providers.",
      },
    ],
  },
  {
    version: "1.0.4",
    date: "2026-10-27",
    items: [
      {
        title: "Production launch fixed",
        detail: "The signed macOS build now opens reliably outside the development environment.",
      },
    ],
  },
  {
    version: "1.0.3",
    date: "2026-10-27",
    items: [
      {
        title: "Stable macOS window startup",
        detail:
          "Removed startup vibrancy that could leave the production window blank or unstable.",
      },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-10-27",
    items: [
      {
        title: "Tray starts when it is needed",
        detail: "The macOS tray webview is created lazily to keep application startup reliable.",
      },
    ],
  },
  {
    version: "1.0.1",
    date: "2026-10-27",
    items: [
      {
        title: "GitHub Enterprise Server",
        detail:
          "Connect to your company GitHub with its hostname and either an existing gh CLI login or a personal access token.",
      },
      {
        title: "One server at a time",
        detail:
          "REST, GraphQL, links, attachments and the local PR mirror follow the active server without mixing company and GitHub.com data.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-05",
    items: [
      {
        title: "A new face",
        detail:
          "One title bar, an icon rail, a list and a page. Graphite surfaces, Cal Sans Text, and colour only where it means something.",
      },
      {
        title: "Inbox by whose turn it is",
        detail:
          "Six verdicts — risky, yours, routine, mergeable, waiting, unsorted — from a rules engine that needs no network, or a hosted model when you give it a key.",
      },
      {
        title: "One page per pull request",
        detail:
          "Description, conversation, commits, checks and every diff in one scroll; threads under the lines they are about; your decision always top-right.",
      },
      {
        title: "Your review survives everything",
        detail:
          "Drafts, read marks and the summary are kept per PR on this machine. A push resets the marks and says so.",
      },
      {
        title: "The model behind two doors",
        detail:
          "A guided tour and a layered plan that keep running when you leave the page, and an Ask panel that works inside your clone.",
      },
      {
        title: "Local repositories as pages",
        detail: "Stage, commit, push, switch branches and open a pull request without leaving.",
      },
    ],
  },
  {
    version: "0.1.8",
    date: "2026-08-14",
    items: [
      {
        title: "Layered review",
        detail:
          "Cut a big PR into a few coherent layers and read them in dependency order — the file tree, [ / ], and n all narrow to the layer you're on.",
      },
      {
        title: "Split with AI, or instantly",
        detail:
          "“Plan with AI” groups files by what they do; “Split by structure” is offline and needs no CLI.",
      },
      {
        title: "Quieter, more readable UI",
        detail:
          "Labels, shortcuts, inputs, and the diff gutter lost their outlines — structure now comes from tint, not from lines. Secondary text got a contrast lift.",
      },
      {
        title: "Clearer AI failures",
        detail:
          "When a provider CLI fails, its actual reason surfaces instead of “produced no output”.",
      },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-07-08",
    items: [
      {
        title: "Detachable AI chat",
        detail: "Pop “Ask about this PR” out into its own resizable window.",
      },
      {
        title: "Configurable AI timeout",
        detail: "Set how long a review or chat may run before it's stopped (Settings → AI review).",
      },
      {
        title: "Redesigned account activity",
        detail: "The contribution heatmap is now full-width and fits without scrolling.",
      },
      {
        title: "This panel",
        detail: "“What's new” now greets you after an update — reopen it any time from About.",
      },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-07-05",
    items: [
      {
        title: "Guided tour always ends with a verdict",
        detail: "Approve, request changes, or comment — each with a one-line reason.",
      },
      {
        title: "Fewer false alarms",
        detail: "Hardened prompting plus a per-concern “Check with AI” against your local clone.",
      },
      {
        title: "AI model selector",
        detail: "Pick a specific model per provider (Claude / Codex / Gemini).",
      },
      {
        title: "Cleaner notifications",
        detail: "No more stale “Review requested” for PRs you’ve already reviewed.",
      },
      {
        title: "Better on large PRs",
        detail: "Prompts stream over stdin with a larger diff budget.",
      },
    ],
  },
];

/** Compare dotted versions: >0 if a>b, <0 if a<b, 0 if equal. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
