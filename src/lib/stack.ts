import { type PrState, prState } from "@/components/pr-row";
import type { PullDetail, PullSummary } from "@/lib/tauri";

export interface StackEntry {
  number: number;
  title: string;
  state: PrState;
  headRef: string;
  baseRef: string;
  isCurrent: boolean;
}

/** Adapt a fetched PullDetail into the PullSummary shape the graph walks over. */
export function detailToSummary(d: PullDetail): PullSummary {
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    state: d.state,
    draft: d.draft,
    user: d.user,
    created_at: d.created_at,
    updated_at: d.updated_at,
    html_url: d.html_url,
    body: d.body,
    labels: [],
    pull_request: d.merged ? { merged_at: d.updated_at } : null,
    head: d.head,
    base: d.base,
  };
}

/**
 * Reconstruct the PR stack that `currentNumber` belongs to.
 *
 * Two PRs are linked when one's `base` branch is the other's `head` branch:
 * the child is stacked *on top of* the parent. We walk down to the bottom of
 * the stack (closest to the default branch) and up to the tip, following the
 * chain through the current PR. Returns bottom→top order, or `[]` when the PR
 * isn't part of a stack (fewer than two linked PRs).
 */
export function buildStack(prs: PullSummary[], currentNumber: number): StackEntry[] {
  const current = prs.find((p) => p.number === currentNumber);
  if (!current?.head || !current.base) return [];

  const byHeadRef = new Map<string, PullSummary>();
  const childrenByBaseRef = new Map<string, PullSummary[]>();
  for (const p of prs) {
    if (p.head) byHeadRef.set(p.head.ref, p);
    if (p.base) {
      const arr = childrenByBaseRef.get(p.base.ref) ?? [];
      arr.push(p);
      childrenByBaseRef.set(p.base.ref, arr);
    }
  }

  const seen = new Set<number>([current.number]);

  // Ancestors: the PR whose head branch is this PR's base branch.
  const ancestors: PullSummary[] = [];
  let cursor: PullSummary | undefined = current;
  while (cursor?.base) {
    const parent = byHeadRef.get(cursor.base.ref);
    if (!parent || seen.has(parent.number)) break;
    ancestors.unshift(parent);
    seen.add(parent.number);
    cursor = parent;
  }

  // Descendants: a PR whose base branch is this PR's head branch.
  const descendants: PullSummary[] = [];
  cursor = current;
  while (cursor?.head) {
    const kids: PullSummary[] = childrenByBaseRef.get(cursor.head.ref) ?? [];
    const next: PullSummary | undefined = kids.find((k) => !seen.has(k.number));
    if (!next) break;
    descendants.push(next);
    seen.add(next.number);
    cursor = next;
  }

  const ordered = [...ancestors, current, ...descendants];
  if (ordered.length < 2) return [];

  return ordered.map((p) => ({
    number: p.number,
    title: p.title,
    state: prState(p),
    headRef: p.head?.ref ?? "",
    baseRef: p.base?.ref ?? "",
    isCurrent: p.number === currentNumber,
  }));
}
