/** When a snoozed item comes back: the choices a row offers. */
export type SnoozeWhen = "later" | "tomorrow" | "week";

export const SNOOZE_LABEL: Record<SnoozeWhen, string> = {
  later: "Later today",
  tomorrow: "Tomorrow morning",
  week: "Next week",
};

/** The ISO time an item returns at. Later today is 17:00, then 21:00, then two hours on. */
export function snoozeUntil(when: SnoozeWhen, now = new Date()): string {
  const d = new Date(now);
  if (when === "later") {
    const h = now.getHours();
    if (h < 17) d.setHours(17, 0, 0, 0);
    else if (h < 21) d.setHours(21, 0, 0, 0);
    else d.setTime(now.getTime() + 2 * 3600_000);
    return d.toISOString();
  }
  d.setDate(d.getDate() + (when === "week" ? 7 : 1));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
