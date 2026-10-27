/** A filesystem path as one opaque route segment, and back. */
export const toLocalId = (path: string): string =>
  btoa(unescape(encodeURIComponent(path)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const fromLocalId = (id: string): string => {
  const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))));
  } catch {
    return id;
  }
};
