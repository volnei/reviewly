/** Actions the AI can propose; the app executes them on user confirmation. */
export type AiAction =
  | { type: "comment"; body: string }
  | { type: "review"; event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body: string }
  | { type: "inline_comment"; path: string; line: number; body: string; side: "LEFT" | "RIGHT" }
  | { type: "label"; add: string[]; remove: string[] };

export interface ParsedMessage {
  /** Markdown prose with the action blocks stripped out. */
  text: string;
  actions: AiAction[];
}

// Primary: <action>{json}</action> — robust even when the JSON body contains
// markdown code fences (``` won't terminate the block, unlike a fenced block).
const TAG_RE = /<action>\s*([\s\S]*?)<\/action>/g;
// Fallback: a fenced ```action / ```json block whose body has no inner fences.
const FENCE_RE = /```[ \t]*[\w-]*[ \t]*\n([\s\S]*?)```/g;

function tryAction(s: string): AiAction | null {
  try {
    return normalize(JSON.parse(s.trim()));
  } catch {
    return null;
  }
}

/** Pull AI action blocks out of an assistant message, leaving prose behind. */
export function parseActions(content: string): ParsedMessage {
  const actions: AiAction[] = [];

  let text = content.replace(TAG_RE, (_match, inner: string) => {
    const action = tryAction(inner);
    if (action) actions.push(action);
    return ""; // strip the tag block whether or not it parsed
  });

  text = text.replace(FENCE_RE, (match, inner: string) => {
    if (!inner.trim().startsWith("{")) return match; // keep non-JSON code blocks
    const action = tryAction(inner);
    if (action) {
      actions.push(action);
      return "";
    }
    return match;
  });

  return { text: text.trim(), actions };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalize(o: unknown): AiAction | null {
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  switch (r.type) {
    case "comment":
      return typeof r.body === "string" ? { type: "comment", body: r.body } : null;
    case "review":
      if (r.event === "APPROVE" || r.event === "REQUEST_CHANGES" || r.event === "COMMENT") {
        return { type: "review", event: r.event, body: typeof r.body === "string" ? r.body : "" };
      }
      return null;
    case "inline_comment":
      if (typeof r.path === "string" && typeof r.line === "number" && typeof r.body === "string") {
        return {
          type: "inline_comment",
          path: r.path,
          line: r.line,
          body: r.body,
          side: r.side === "LEFT" ? "LEFT" : "RIGHT",
        };
      }
      return null;
    case "label":
      return { type: "label", add: strings(r.add), remove: strings(r.remove) };
    default:
      return null;
  }
}

export function actionTitle(a: AiAction): string {
  switch (a.type) {
    case "comment":
      return "Post comment";
    case "review":
      return a.event === "APPROVE"
        ? "Approve pull request"
        : a.event === "REQUEST_CHANGES"
          ? "Request changes"
          : "Submit review comment";
    case "inline_comment":
      return `Comment on ${a.path}:${a.line}`;
    case "label": {
      const parts: string[] = [];
      if (a.add.length) parts.push(`+${a.add.join(", ")}`);
      if (a.remove.length) parts.push(`−${a.remove.join(", ")}`);
      return `Update labels ${parts.join("  ")}`;
    }
  }
}
