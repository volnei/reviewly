export const PR_ORIGINS = {
  home: { to: "/", label: "Home" },
  inbox: { to: "/inbox", label: "Inbox" },
  prs: { to: "/prs", label: "Pull requests" },
  mentions: { to: "/mentions", label: "Mentions" },
  health: { to: "/health", label: "Health" },
  "fast-lane": { to: "/fast-lane", label: "Fast lane" },
  team: { to: "/team", label: "Review queue" },
  "merge-lab": { to: "/merge-lab", label: "Merge Lab" },
  history: { to: "/history", label: "History" },
} as const;

export type PrOrigin = keyof typeof PR_ORIGINS;

export const parsePrOrigin = (value: unknown): PrOrigin | undefined =>
  typeof value === "string" && Object.hasOwn(PR_ORIGINS, value) ? (value as PrOrigin) : undefined;
