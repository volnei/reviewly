import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeRow } from "../src/screens/local-repo";

const render = (path: string, current = false) => renderToStaticMarkup(
  <ChangeRow f={{path, status: "?"}} current={current} onSelect={() => {}} actions={null} />,
);

test("untracked directories retain a visible name instead of a blank row", () => {
  const html = render("wt-featdead/");
  expect(html).toContain(">wt-featdead</span>");
  expect(html).toContain("Untracked directory");
  expect(html).toContain('data-slot="button"');
});

test("nested files show the name and containing directory separately", () => {
  const html = render("src/payments/service.ts", true);
  expect(html).toContain(">service.ts</span>");
  expect(html).toContain(">src/payments</span>");
  expect(html).toContain('aria-current="true"');
  expect(html).not.toContain("border-l");
});

test("Windows paths also retain a visible basename", () => {
  expect(render("src\\payments\\service.ts")).toContain(">service.ts</span>");
});
