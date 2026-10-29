/**
 * Sample-data mode: the desktop app answered by the fixtures instead of GitHub,
 * for someone who wants to look before signing in (and for App Review). Chosen
 * once at launch, like the backend itself; switching reloads the window.
 */
const KEY = "reviewly.demo";

export const isDemo = (): boolean => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** Persisted keys live apart in the demo, so it never touches the real account's state. */
export const storageKey = (key: string): string => (isDemo() ? `demo.${key}` : key);

export function setDemo(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    return;
  }
  window.location.reload();
}
