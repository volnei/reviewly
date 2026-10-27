import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Ranked } from "../src/effect/services/Triage";
import { Row } from "../src/features/list/row";

const item: Ranked = {
  id: "pr:owner/repo#42",
  repo: "owner/repo",
  number: 42,
  title: "Fix booking validation",
  kind: "pr",
  mine: false,
  verdict: "risky",
  why: "the title says it touches something that bites",
  author: "alice",
  ci: "failure",
};
const render = (inStack: boolean) =>
  renderToStaticMarkup(
    <Row
      item={inStack ? { ...item, stack: { number: 7, position: 2, size: 4, base: "main" } } : item}
      inStack={inStack}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

test("stacked and standalone PRs share the same row, status and actions", () => {
  for (const html of [render(true), render(false)]) {
    expect(html).toContain('class="pr-list-row"');
    expect(html).toContain("Fix booking validation");
    expect(html).toContain("CI failing");
    expect(html).toContain("Actions for pull request 42");
    expect(html).not.toContain("risky");
    expect(html).not.toContain("the title says");
  }
});

test("both variants preserve the same repository metadata", () => {
  expect(render(false)).toContain("<span>owner/repo</span>");
  expect(render(true)).toContain("<span>owner/repo</span>");
});

test("a stacked row states its position and total instead of implying a complete local list", () => {
  const html = render(true);
  expect(html).toContain('aria-label="Layer 2 of 4"');
  expect(html).toContain("2/4");
});
