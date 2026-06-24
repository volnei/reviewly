import { Check, Clock, type LucideIcon, X } from "lucide-react";

/**
 * One status → colour/icon language for the whole app, so CI, review state and
 * advisory severity read the same everywhere. Colours are the semantic theme
 * tokens (`text-success` / `text-destructive` / `text-warning`).
 */

export interface StatusMeta {
  icon: LucideIcon;
  tone: string;
  label: string;
}

export type CiState = "success" | "failure" | "pending" | "none" | (string & {});

const CI: Record<"success" | "failure" | "pending", StatusMeta> = {
  success: { icon: Check, tone: "text-success", label: "CI passing" },
  failure: { icon: X, tone: "text-destructive", label: "CI failing" },
  pending: { icon: Clock, tone: "text-warning", label: "CI pending" },
};

/** Meta for a CI rollup, or `null` when there's nothing meaningful to show. */
export function ciMeta(ci?: CiState | null): StatusMeta | null {
  if (!ci || ci === "none") return null;
  if (ci === "success") return CI.success;
  if (ci === "failure") return CI.failure;
  return CI.pending;
}

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | (string & {}) | null;

const REVIEW: Record<"APPROVED" | "CHANGES_REQUESTED", StatusMeta> = {
  APPROVED: { icon: Check, tone: "text-success", label: "Approved" },
  CHANGES_REQUESTED: { icon: X, tone: "text-destructive", label: "Changes requested" },
};

/** Meta for a review decision, or `null` when there's no decision to show. */
export function reviewMeta(r?: ReviewState): StatusMeta | null {
  if (r === "APPROVED") return REVIEW.APPROVED;
  if (r === "CHANGES_REQUESTED") return REVIEW.CHANGES_REQUESTED;
  return null;
}

/** Badge classes for a security-advisory severity (Dependabot). */
export function severityTone(sev: string): string {
  switch (sev.toLowerCase()) {
    case "critical":
      return "bg-destructive text-destructive-foreground ring-1 ring-destructive/40";
    case "high":
      return "bg-destructive/15 text-destructive";
    case "medium":
      return "bg-warning/20 font-semibold text-warning";
    default:
      return "bg-foreground/[0.1] text-foreground/70";
  }
}
