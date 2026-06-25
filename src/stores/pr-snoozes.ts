import { sqlStorage } from "@/lib/sql-storage";
import type { DashboardPr } from "@/lib/tauri";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SnoozeKind = "later-today" | "tomorrow" | "next-week" | "until-ci-changes";

export interface PrSnooze {
  key: string;
  fallbackKey: string;
  repo: string;
  number: number;
  title: string;
  kind: SnoozeKind;
  createdAt: number;
  dueAt: number | null;
  capturedCi: DashboardPr["ci"] | null;
}

interface State {
  snoozes: Record<string, PrSnooze>;
  snooze: (pr: DashboardPr, kind: SnoozeKind, now?: number) => PrSnooze;
  unsnooze: (prOrKey: DashboardPr | string) => void;
}

export function prFallbackKey(pr: Pick<DashboardPr, "repo" | "number">): string {
  return `pr:${pr.repo}#${pr.number}`;
}

export function prSnoozeKey(pr: Pick<DashboardPr, "id" | "repo" | "number">): string {
  return pr.id ? `id:${pr.id}` : prFallbackKey(pr);
}

export function getPrSnooze(
  snoozes: Record<string, PrSnooze>,
  pr: Pick<DashboardPr, "id" | "repo" | "number">,
): PrSnooze | null {
  return snoozes[prSnoozeKey(pr)] ?? snoozes[prFallbackKey(pr)] ?? null;
}

function dueAtFor(kind: SnoozeKind, now: number): number | null {
  const d = new Date(now);
  if (kind === "later-today") {
    d.setHours(17, 0, 0, 0);
    if (d.getTime() <= now) d.setHours(21, 0, 0, 0);
    if (d.getTime() <= now) return now + 2 * 60 * 60 * 1000;
    return d.getTime();
  }
  if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  if (kind === "next-week") {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  return null;
}

export function isPrSnoozed(pr: DashboardPr, snooze: PrSnooze | null, now = Date.now()): boolean {
  if (!snooze) return false;
  if (snooze.kind === "until-ci-changes") return snooze.capturedCi === pr.ci;
  return snooze.dueAt == null || snooze.dueAt > now;
}

export const usePrSnoozes = create<State>()(
  persist(
    (set) => ({
      snoozes: {},
      snooze: (pr, kind, now = Date.now()) => {
        const entry: PrSnooze = {
          key: prSnoozeKey(pr),
          fallbackKey: prFallbackKey(pr),
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          kind,
          createdAt: now,
          dueAt: dueAtFor(kind, now),
          capturedCi: kind === "until-ci-changes" ? pr.ci : null,
        };
        set((state) => ({
          snoozes: {
            ...state.snoozes,
            [entry.key]: entry,
            [entry.fallbackKey]: entry,
          },
        }));
        return entry;
      },
      unsnooze: (prOrKey) =>
        set((state) => {
          const key =
            typeof prOrKey === "string"
              ? prOrKey
              : (getPrSnooze(state.snoozes, prOrKey)?.key ?? prSnoozeKey(prOrKey));
          const entry = state.snoozes[key];
          const next = { ...state.snoozes };
          delete next[key];
          if (entry) {
            delete next[entry.key];
            delete next[entry.fallbackKey];
          }
          return { snoozes: next };
        }),
    }),
    { name: "reviewly.pr-snoozes", storage: sqlStorage<State>() },
  ),
);
