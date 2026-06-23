import type { CheckRun } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { Check, Clock, Loader2, MinusCircle, OctagonX, X } from "lucide-react";

type Summary = "success" | "failure" | "pending" | "neutral" | "none";

interface ChecksSummary {
  summary: Summary;
  pass: number;
  fail: number;
  pending: number;
  total: number;
  /** Counts restricted to checks that are *required* (branch protection). */
  requiredFail: number;
  requiredPending: number;
  requiredPass: number;
  requiredTotal: number;
  /** Failures that actually block the merge — required ones when we know which
   * are required, otherwise all of them. */
  blockingFail: number;
}

/** Bucket a single run. `none` = neutral/skipped/cancelled/stale (doesn't count). */
function bucketOf(r: CheckRun): "pass" | "fail" | "pending" | "none" {
  if (r.status !== "completed") return "pending";
  switch (r.conclusion) {
    case "success":
      return "pass";
    case "failure":
    case "timed_out":
    case "action_required":
      return "fail";
    default:
      return "none";
  }
}

/**
 * Aggregate check runs. When `required` (the names from branch protection) is
 * given and non-empty, the headline `summary` is driven by REQUIRED checks only
 * — a failing *optional* check no longer marks the PR as broken, and a required
 * check that hasn't run yet counts as pending (it blocks the merge).
 */
export function summarizeChecks(
  runs: CheckRun[] | undefined | null,
  required?: Set<string> | null,
): ChecksSummary {
  const hasRequired = !!required && required.size > 0;
  const requiredTotal = hasRequired ? (required as Set<string>).size : 0;
  const base: ChecksSummary = {
    summary: "none",
    pass: 0,
    fail: 0,
    pending: 0,
    total: 0,
    requiredFail: 0,
    requiredPending: 0,
    requiredPass: 0,
    requiredTotal,
    blockingFail: 0,
  };
  if (!runs || runs.length === 0) {
    // Required checks that haven't reported yet still block → pending.
    if (hasRequired) return { ...base, summary: "pending", requiredPending: requiredTotal };
    return base;
  }

  let pass = 0;
  let fail = 0;
  let pending = 0;
  let rPass = 0;
  let rFail = 0;
  let rPending = 0;
  const present = new Set<string>();
  for (const r of runs) {
    present.add(r.name);
    const b = bucketOf(r);
    if (b === "pass") pass++;
    else if (b === "fail") fail++;
    else if (b === "pending") pending++;
    if (hasRequired && (required as Set<string>).has(r.name)) {
      if (b === "pass") rPass++;
      else if (b === "fail") rFail++;
      else if (b === "pending") rPending++;
    }
  }
  // A required check with no run on this head is still pending (blocks merge).
  if (hasRequired) {
    for (const name of required as Set<string>) if (!present.has(name)) rPending++;
  }

  const pick = (f: number, p: number, ok: number): Summary =>
    f > 0 ? "failure" : p > 0 ? "pending" : ok > 0 ? "success" : "neutral";
  const summary = hasRequired ? pick(rFail, rPending, rPass) : pick(fail, pending, pass);

  return {
    summary,
    pass,
    fail,
    pending,
    total: runs.length,
    requiredFail: rFail,
    requiredPending: rPending,
    requiredPass: rPass,
    requiredTotal,
    blockingFail: hasRequired ? rFail : fail,
  };
}

export function ChecksBadge({
  runs,
  className,
}: {
  runs: CheckRun[] | undefined | null;
  className?: string;
}) {
  const s = summarizeChecks(runs);
  if (s.summary === "none") return null;
  const { Icon, tone, label, spin } = badgeStyle(s);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", tone, className)}
      aria-label={`${s.pass} passed · ${s.fail} failed · ${s.pending} pending · ${s.total} total`}
    >
      <Icon className={cn("size-3", spin && "animate-spin")} strokeWidth={2} />
      {label}
    </span>
  );
}

function badgeStyle(s: ReturnType<typeof summarizeChecks>) {
  switch (s.summary) {
    case "success":
      return {
        Icon: Check,
        tone: "text-success",
        label: `${s.pass}/${s.total} checks passed`,
        spin: false,
      };
    case "failure":
      // A *required* failure blocks the merge — flag it with a heavier "stop"
      // glyph so it reads stronger than an ordinary (maybe optional) failure.
      return {
        Icon: s.requiredTotal > 0 ? OctagonX : X,
        tone: "text-destructive",
        label: s.requiredTotal > 0 ? `${s.blockingFail} required failing` : `${s.fail} failing`,
        spin: false,
      };
    case "pending":
      return {
        Icon: Loader2,
        tone: "text-warning",
        label: `${s.pending} running`,
        spin: true,
      };
    default:
      // "neutral" = checks exist but none block — informational, not pending.
      return {
        Icon: MinusCircle,
        tone: "text-info",
        label: "no required checks",
        spin: false,
      };
  }
}

/** Single-check row styling helpers (used inside the Checks tab list). */
export function checkRowIcon(run: CheckRun) {
  if (run.status !== "completed") {
    return { Icon: Loader2, tone: "text-warning", spin: true } as const;
  }
  switch (run.conclusion) {
    case "success":
      return { Icon: Check, tone: "text-success", spin: false } as const;
    case "failure":
    case "timed_out":
    case "action_required":
      return { Icon: X, tone: "text-destructive", spin: false } as const;
    case "cancelled":
    case "skipped":
    case "stale":
      return { Icon: MinusCircle, tone: "text-muted-foreground", spin: false } as const;
    default:
      return { Icon: Clock, tone: "text-muted-foreground", spin: false } as const;
  }
}
