import { toast } from "@/app/toast";
import { run } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { Section } from "@/features/pr/section";
import { type RepoHealth, buildReport, problemCount } from "@/lib/turbo-health";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { useCallback } from "react";

/**
 * What the Turborepo in this clone says about itself: the packages that carry
 * the most, the cycles, the imports nobody declared, the versions that
 * disagree, the imports that reach into another package. Every file named
 * opens in your editor; the whole report copies as a work order for an agent.
 */
export function WorkspaceSection({
  health,
  open = false,
  title,
}: { health: RepoHealth; open?: boolean; title?: string }) {
  const editorTarget = usePrefs((p) => p.editorTarget);
  const openFile = useCallback(
    async (file: string, line?: number) => {
      const path = `${health.path}/${file}`;
      try {
        const targets = await run(Effect.flatMap(Git, (g) => g.editorTargets));
        const target = targets.find((t) => t.id === editorTarget) ?? targets[0];
        if (!target) {
          toast.say("No editor found on this machine");
          return;
        }
        prefsStore.update((p) =>
          p.editorTarget === target.id ? p : { ...p, editorTarget: target.id },
        );
        await run(
          Effect.flatMap(Git, (g) => g.openEditor(line ? `${path}:${line}` : path, target.id)),
        );
      } catch (e) {
        toast.fail("Couldn’t open the file", e);
      }
    },
    [health.path, editorTarget],
  );
  const copy = () =>
    navigator.clipboard
      .writeText(buildReport(health))
      .then(() =>
        toast.say("Report copied", "Paste it to your agent: it is a complete work order."),
      )
      .catch(() => toast.fail("Couldn’t copy it"));
  const n = problemCount(health);
  const s = health.scan;
  return (
    <Section
      title={title ?? `Workspace · ${n ? `${n} finding${n === 1 ? "" : "s"}` : "nothing to fix"}`}
      open={open}
      aside={
        <button
          type="button"
          onClick={copy}
          className="h-6 rounded-md px-2 text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          Copy the report for an agent
        </button>
      }
    >
      <div className="grid max-w-[760px] gap-5 text-[12.5px]">
        <p className="tnum text-ink-3">
          {s.packages.length} packages · {s.edges.length} internal edges · {s.deps.length} external
          dependencies · chains up to {health.depth} deep
        </p>
        <Block title="Carrying the most" empty="">
          {health.stats.slice(0, 8).map((p) => (
            <li
              key={p.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
              title={`${p.dependents} depend on it directly · a change ripples into ${p.blast} package${p.blast === 1 ? "" : "s"} · it pulls in ${p.deps}`}
            >
              <span className="mono truncate text-ink-2">{p.name}</span>
              <span className="tnum text-ink-3">
                ← {p.dependents} · ripples into {p.blast}
              </span>
            </li>
          ))}
        </Block>
        <Block title="Dependency cycles" empty="None: the package graph is a DAG.">
          {health.cycles.map((c) => (
            <li key={c.join(">")} className="mono text-amber">
              {c.join(" → ")} → {c[0]}
            </li>
          ))}
        </Block>
        <Block
          title="Imports nobody declared"
          empty="Every import of a workspace package is backed by a dependency."
        >
          {health.phantoms.map((p) => (
            <li key={`${p.from_pkg}>${p.target}`}>
              <button
                type="button"
                onClick={() => openFile(p.example_file, p.example_line)}
                className="text-left hover:text-ink"
                title={`${p.example_file}:${p.example_line}`}
              >
                <span className="mono text-ink-2">{p.from_pkg}</span> imports{" "}
                <span className="mono text-ink-2">{p.target}</span>{" "}
                <span className="text-ink-3">
                  {p.count}× without declaring it — works only through hoisting
                </span>
              </button>
            </li>
          ))}
        </Block>
        <Block title="Versions that disagree" empty="Every external dependency has one range.">
          {health.mismatches.map((m) => (
            <li key={m.name} className="grid gap-0.5">
              <span>
                <span className="mono text-ink-2">{m.name}</span>{" "}
                <span className="text-ink-3">— align to {m.majority}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {m.versions.map((v) => (
                  <span
                    key={v.version}
                    className={cn(
                      "mono rounded-[3px] px-1.5 py-px text-[11px]",
                      v.version === m.majority ? "bg-raise text-ink-2" : "bg-amber/15 text-amber",
                    )}
                    title={v.packages.join(", ")}
                  >
                    {v.version} · {v.packages.length}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </Block>
        <Block
          title="Imports reaching into another package"
          empty="No import reaches into another package’s internals."
        >
          {s.crossings.map((c) => (
            <li key={`${c.file}:${c.line}`}>
              <button
                type="button"
                onClick={() => openFile(c.file, c.line)}
                className="text-left hover:text-ink"
              >
                <span className="mono text-ink-2">
                  {c.file}:{c.line}
                </span>{" "}
                <span className="text-ink-3">
                  → {c.target} <span className="mono">({c.spec})</span>
                </span>
              </button>
            </li>
          ))}
        </Block>
        {health.unused.length ? (
          <Block
            title="Declared, never imported"
            empty=""
            hint="No import in the scanned source; a script or a config may still use it."
          >
            {health.unused.map((u) => (
              <li key={`${u.from}>${u.to}`} className="text-ink-3">
                <span className="mono text-ink-2">{u.from}</span> →{" "}
                <span className="mono">{u.to}</span> ({u.kind})
              </li>
            ))}
          </Block>
        ) : null}
      </div>
    </Section>
  );
}

function Block({
  title,
  empty,
  hint,
  children,
}: { title: string; empty: string; hint?: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
  const has = kids.some((k) => k != null && k !== false && !(Array.isArray(k) && k.length === 0));
  return (
    <div>
      <p className="text-[12px] text-ink-3">
        {title}
        {hint ? <span className="ml-2">{hint}</span> : null}
      </p>
      {has ? (
        <ul className="mt-1 grid max-h-64 gap-1 overflow-y-auto scrollbar-thin">{children}</ul>
      ) : empty ? (
        <p className="mt-1 text-ink-3">{empty}</p>
      ) : null}
    </div>
  );
}
