import { describe, expect, test } from "bun:test";
import {
  type RepoHealth,
  architectureActions,
  architectureNodes,
  architectureSignals,
} from "../src/lib/turbo-health";
import { parseCodeowners } from "../src/lib/codeowners";

const health: RepoHealth = {
  owner: "reviewly",
  repo: "workspace",
  path: "/workspace",
  scan: {
    packages: [
      { name: "web", dir: "apps/web" },
      { name: "checkout", dir: "packages/checkout" },
      { name: "ui", dir: "packages/ui" },
      { name: "tokens", dir: "packages/tokens" },
    ],
    edges: [
      ["web", "checkout"],
      ["web", "ui"],
      ["checkout", "ui"],
      ["ui", "tokens"],
    ],
    dep_edges: [
      { from: "web", to: "checkout", kind: "dependencies" },
      { from: "web", to: "ui", kind: "dependencies" },
      { from: "checkout", to: "ui", kind: "dependencies" },
      { from: "ui", to: "tokens", kind: "dependencies" },
    ],
    crossings: [
      {
        file: "apps/web/page.tsx",
        line: 4,
        spec: "ui/src/button",
        from_pkg: "web",
        target: "ui",
      },
    ],
    member_uses: [
      {
        from_pkg: "web",
        target: "checkout",
        count: 2,
        example_file: "apps/web/a.ts",
        example_line: 1,
      },
      { from_pkg: "web", target: "ui", count: 5, example_file: "apps/web/b.ts", example_line: 2 },
      {
        from_pkg: "checkout",
        target: "ui",
        count: 3,
        example_file: "packages/checkout/a.ts",
        example_line: 3,
      },
      {
        from_pkg: "ui",
        target: "tokens",
        count: 7,
        example_file: "packages/ui/a.ts",
        example_line: 4,
      },
    ],
    deps: [],
  },
  cycles: [],
  mismatches: [],
  phantoms: [
    { from_pkg: "web", target: "ui", count: 5, example_file: "apps/web/b.ts", example_line: 2 },
  ],
  unused: [],
  stats: [],
  depth: 3,
};

describe("living architecture", () => {
  test("ranks packages by transitive blast radius", () => {
    expect(architectureNodes(health).map((node) => node.name)).toEqual([
      "tokens",
      "ui",
      "checkout",
      "web",
    ]);
  });

  test("connects graph position to observed imports and findings", () => {
    const ui = architectureNodes(health).find((node) => node.name === "ui");
    expect(ui).toMatchObject({
      dependencies: ["tokens"],
      dependents: ["checkout", "web"],
      transitiveDependencies: ["tokens"],
      transitiveDependents: ["checkout", "web"],
      importsIn: 8,
      importsOut: 7,
      boundaryFindings: 1,
      phantomFindings: 1,
    });
  });

  test("distinguishes applications from reusable packages", () => {
    const nodes = architectureNodes(health);
    expect(nodes.find((node) => node.name === "web")?.kind).toBe("app");
    expect(nodes.find((node) => node.name === "tokens")?.kind).toBe("package");
  });

  test("adds git hotspots, test surface and ownership to each package", () => {
    const signals = architectureSignals(
      health,
      ["packages/ui/src/button.tsx", "packages/ui/src/button.test.tsx", "packages/ui/src/theme.ts"],
      [
        {
          path: "packages/ui/src/button.tsx",
          last_short: "abc123",
          last_author: "Marina",
          last_time: 20,
          last_subject: "fix button",
          churn: 9,
        },
        {
          path: "packages/ui/src/theme.ts",
          last_short: "def456",
          last_author: "Volnei",
          last_time: 30,
          last_subject: "theme tokens",
          churn: 4,
        },
      ],
      parseCodeowners("/packages/ui/ @frontend @design-system"),
    );
    expect(signals.find((signal) => signal.name === "ui")).toMatchObject({
      files: 3,
      testFiles: 1,
      churn: 13,
      owners: ["@design-system", "@frontend"],
      contributors: [
        { name: "Marina", churn: 9 },
        { name: "Volnei", churn: 4 },
      ],
    });
  });

  test("turns findings into concrete, prioritized repair tasks", () => {
    const actions = architectureActions(health);
    expect(actions.map((action) => action.title)).toEqual([
      "Declare ui in web",
      "Restore the public boundary between web and ui",
    ]);
    expect(actions[0]).toMatchObject({ priority: "high", file: "apps/web/b.ts", line: 2 });
    expect(actions[0].fix).toContain("apps/web/package.json");
  });

  test("puts cycles first and identifies the cheapest edge to cut", () => {
    const cyclic: RepoHealth = {
      ...health,
      scan: {
        ...health.scan,
        edges: [...health.scan.edges, ["ui", "checkout"]],
        dep_edges: [
          ...health.scan.dep_edges,
          { from: "ui", to: "checkout", kind: "devDependencies" },
        ],
      },
      cycles: [["checkout", "ui"]],
    };
    const first = architectureActions(cyclic)[0];
    expect(first).toMatchObject({ priority: "critical", category: "cycle" });
    expect(first.fix).toContain("ui → checkout");
    expect(first.fix).toContain("devDependencies");
  });

  test("queues missing tests and ownership only for high-impact packages", () => {
    const signals = architectureSignals(health, ["packages/tokens/src/index.ts"], [], []);
    const titles = architectureActions(health, signals).map((action) => action.title);
    expect(titles).toContain("Add a contract test around tokens");
    expect(titles).toContain("Assign an owner to tokens");
    expect(titles).not.toContain("Add a contract test around web");
  });
});
