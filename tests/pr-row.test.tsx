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
    expect(html).toContain('aria-label="CI failing"');
    expect(html).toContain("lucide-circle-x");
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

test("shows unresolved review threads as a blocking row status", () => {
  const html = renderToStaticMarkup(
    <Row
      item={{ ...item, ci: "success", unresolved: 3 }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

  expect(html).toContain('aria-label="3 unresolved review threads"');
  expect(html).toContain(">3</span>");
  expect(html).not.toContain("open threads</span>");
  expect(html).not.toContain('data-slot="badge"');
});

test("shows the primary blocker and open threads as matching compact signals", () => {
  const html = renderToStaticMarkup(
    <Row
      item={{ ...item, unresolved: 2 }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

  expect(html).toContain('aria-label="CI failing"');
  expect(html).toContain('aria-label="2 unresolved review threads"');
  expect(html).toContain("lucide-circle-x");
  expect(html).toContain("lucide-message-square");
  expect(html).toContain(">2</span>");
  expect(html).not.toContain(">CI failing<");
});

test("renders changes requested as only an icon and the unresolved count", () => {
  const html = renderToStaticMarkup(
    <Row
      item={{ ...item, ci: "success", reviewDecision: "CHANGES_REQUESTED", unresolved: 2 }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

  expect(html).toContain("lucide-message-square-x");
  expect(html).toContain('aria-label="Changes requested"');
  expect(html).toContain(">2</span>");
  expect(html).not.toContain(">Changes requested<");
});

test("renders merge conflicts as only a matching red icon", () => {
  const html = renderToStaticMarkup(
    <Row
      item={{ ...item, ci: "success", conflicting: true }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

  expect(html).toContain("lucide-git-merge");
  expect(html).toContain('aria-label="Conflicts"');
  expect(html).not.toContain(">Conflicts<");
});

test("uses the same icon system for ready and draft states", () => {
  const ready = renderToStaticMarkup(
    <Row
      item={{ ...item, ci: "success", verdict: "mergeable" }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );
  const draft = renderToStaticMarkup(
    <Row
      item={{ ...item, ci: "success", draft: true }}
      selected={false}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );

  expect(ready).toContain("lucide-circle-check");
  expect(ready).toContain('aria-label="Ready to merge"');
  expect(draft).toContain("lucide-git-pull-request-draft");
  expect(draft).toContain('aria-label="Draft"');
});
