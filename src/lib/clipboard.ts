const markdownLabel = (value: string) => value.replace(/([\\[\]])/g, "\\$1");

const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

export const namedLinkText = (title: string, url: string) => `[${markdownLabel(title)}](${url})`;

export const namedLinkHtml = (title: string, url: string) =>
  `<a href="${html(url)}">${html(title)}</a>`;

/** Copy a named hyperlink, with Markdown as the portable plain-text fallback. */
export async function copyNamedLink(title: string, url: string): Promise<void> {
  const text = namedLinkText(title, url);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([namedLinkHtml(title, url)], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some WebViews expose ClipboardItem but only allow text writes.
    }
  }
  await navigator.clipboard.writeText(text);
}
