import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { PullFile } from "../src/effect/schema";
import { FileRow } from "../src/features/pr/file-row";

const file = {
  filename: "src/example.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
} as PullFile;

test("viewed files keep an explicit label even when selected", () => {
  const html = renderToStaticMarkup(
    <FileRow f={file} read current threads={0} drafts={0} onSelect={() => {}} />,
  );
  expect(html).toContain('data-viewed="true"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain(">Viewed</span>");
});

test("unviewed files do not claim completion", () => {
  const html = renderToStaticMarkup(
    <FileRow f={file} read={false} current={false} threads={0} drafts={0} onSelect={() => {}} />,
  );
  expect(html).not.toContain("data-viewed");
  expect(html).not.toContain(">Viewed</span>");
  expect(html).toContain('aria-label="unread"');
});
