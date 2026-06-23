/**
 * Pixel coordinates of the caret inside a <textarea>, relative to the element's
 * top-left (before scroll). Uses the classic hidden-mirror technique: clone the
 * textarea's text-affecting styles into an off-screen div, place a marker span
 * at the caret offset, and measure it. Used to anchor the emoji autocomplete.
 */
const MIRRORED_PROPS = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

export function getCaretCoordinates(
  el: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const div = document.createElement("div");
  const computed = window.getComputedStyle(el);
  const style = div.style;
  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  const writable = style as unknown as Record<string, string>;
  for (const prop of MIRRORED_PROPS) {
    writable[prop] = computed[prop as keyof CSSStyleDeclaration] as string;
  }
  document.body.appendChild(div);
  div.textContent = el.value.slice(0, position);
  const span = document.createElement("span");
  // Non-empty so it has measurable layout; the char itself doesn't matter.
  span.textContent = el.value.slice(position) || ".";
  div.appendChild(span);

  const lineHeight = Number.parseInt(computed.lineHeight, 10);
  const coords = {
    top: span.offsetTop + Number.parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + Number.parseInt(computed.borderLeftWidth, 10),
    height: Number.isNaN(lineHeight) ? Number.parseInt(computed.fontSize, 10) : lineHeight,
  };
  document.body.removeChild(div);
  return coords;
}
