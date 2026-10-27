import { describe, expect, test } from "bun:test";
import { namedLinkHtml, namedLinkText } from "../src/lib/clipboard";

describe("Named pull request links", () => {
  test("uses the pull request title as the Markdown label", () => {
    expect(namedLinkText("Fix [billing] retries", "https://github.com/acme/app/pull/42")).toBe(
      "[Fix \\[billing\\] retries](https://github.com/acme/app/pull/42)",
    );
  });

  test("escapes rich link content before writing HTML", () => {
    expect(namedLinkHtml('Fix <billing> & "retry"', "https://example.com/?a=1&b=2")).toBe(
      '<a href="https://example.com/?a=1&amp;b=2">Fix &lt;billing&gt; &amp; &quot;retry&quot;</a>',
    );
  });
});
