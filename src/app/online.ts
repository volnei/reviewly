import { useSyncExternalStore } from "react";

const subscribe = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};
const get = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/** Whether the machine has a network, as the browser sees it. */
export const useOnline = () => useSyncExternalStore(subscribe, get, get);
