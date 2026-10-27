import { useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { Git } from "@/effect/services/Git";
import { age } from "@/features/list/row";
import { type CodeownersRule, ownersFor, parseCodeowners } from "@/lib/codeowners";
import { fileIcon } from "@/lib/file-icons";
import { detectLanguage, highlightLine } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

/** What the tree knows about a path beyond its name. */
export interface Decorations {
  /** Uncommitted: the git status letter. */
  readonly status: ReadonlyMap<string, string>;
  /** Against the base branch: lines added and removed. */
  readonly changes: ReadonlyMap<string, { additions: number; deletions: number }>;
  readonly activity: ReadonlyMap<string, S.FileActivity>;
  readonly owners: ReadonlyArray<CodeownersRule>;
}

const EMPTY: Decorations = {
  status: new Map(),
  changes: new Map(),
  activity: new Map(),
  owners: [],
};

/** The three places GitHub reads CODEOWNERS from, first hit wins. */
const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** Everything the rows show: status, churn, owners, lines against the base. */
export function useDecorations(
  repo: string,
  tree: S.WorkingTree | undefined,
  changes: S.BranchChanges | undefined,
): Decorations {
  const activity = useEffectQuery(
    ["local-repo", repo, "activity"],
    Effect.flatMap(Git, (g) => g.fileActivity(repo, 90)),
    { staleTime: 5 * 60_000, retry: false },
  );
  const owners = useEffectQuery(
    ["local-repo", repo, "codeowners"],
    Effect.gen(function* () {
      const g = yield* Git;
      for (const p of CODEOWNERS_PATHS) {
        const text = yield* g.readFile(`${repo}/${p}`).pipe(Effect.orElseSucceed(() => null));
        if (text != null) return parseCodeowners(text);
      }
      return [] as CodeownersRule[];
    }),
    { staleTime: Number.POSITIVE_INFINITY, retry: false },
  );
  return useMemo(() => {
    const status = new Map<string, string>();
    for (const f of tree?.staged ?? []) status.set(f.path, f.status);
    for (const f of tree?.unstaged ?? []) status.set(f.path, f.status === "?" ? "U" : f.status);
    const ch = new Map<string, { additions: number; deletions: number }>();
    for (const f of changes?.files ?? []) ch.set(f.path, f);
    const act = new Map<string, S.FileActivity>();
    for (const a of activity.data ?? []) act.set(a.path, a);
    return { ...EMPTY, status, changes: ch, activity: act, owners: owners.data ?? [] };
  }, [tree, changes, activity.data, owners.data]);
}

/** The files of a clone as a tree: folders open lazily, rows carry what git knows. */
export function FileBrowser({
  repo,
  selected,
  onSelect,
  deco,
}: {
  repo: string;
  selected: string | null;
  onSelect: (rel: string) => void;
  deco: Decorations;
}) {
  return (
    <ul className="text-[12.5px]" role="tree" aria-label="Files">
      <FolderRows
        repo={repo}
        rel=""
        depth={0}
        selected={selected}
        onSelect={onSelect}
        deco={deco}
      />
    </ul>
  );
}

const dirtyInside = (deco: Decorations, rel: string) => {
  const prefix = `${rel}/`;
  for (const p of deco.status.keys()) if (p.startsWith(prefix)) return true;
  return false;
};

function FolderRows({
  repo,
  rel,
  depth,
  selected,
  onSelect,
  deco,
}: {
  repo: string;
  rel: string;
  depth: number;
  selected: string | null;
  onSelect: (rel: string) => void;
  deco: Decorations;
}) {
  const entries = useEffectQuery(
    ["local-repo", repo, "dir", rel],
    Effect.flatMap(Git, (g) => g.listDir(rel ? `${repo}/${rel}` : repo)),
    { staleTime: 30_000, retry: false },
  );
  const max = Math.max(1, ...[...deco.activity.values()].map((a) => a.churn));
  return (
    <>
      {(entries.data ?? []).map((e) => {
        const path = rel ? `${rel}/${e.name}` : e.name;
        return e.is_dir ? (
          <FolderRow
            key={path}
            repo={repo}
            rel={path}
            name={e.name}
            depth={depth}
            selected={selected}
            onSelect={onSelect}
            deco={deco}
          />
        ) : (
          <FileRow
            key={path}
            rel={path}
            name={e.name}
            depth={depth}
            selected={selected === path}
            onSelect={() => onSelect(path)}
            deco={deco}
            max={max}
          />
        );
      })}
      {entries.isError ? (
        <li className="px-3 py-1 text-[12px] text-ink-3">Couldn’t read this folder.</li>
      ) : null}
    </>
  );
}

function FolderRow({
  repo,
  rel,
  name,
  depth,
  selected,
  onSelect,
  deco,
}: {
  repo: string;
  rel: string;
  name: string;
  depth: number;
  selected: string | null;
  onSelect: (rel: string) => void;
  deco: Decorations;
}) {
  const [open, setOpen] = useState(depth === 0 && (name === "src" || name === "apps"));
  const dirty = dirtyInside(deco, rel);
  const Icon = open ? FolderOpen : Folder;
  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-ink-2 hover:bg-raise/50 hover:text-ink"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <ChevronRight
          className={cn("size-3 shrink-0 text-ink-3 transition-transform", open && "rotate-90")}
          strokeWidth={2}
        />
        <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="mono truncate text-[12px]">{name}</span>
        {dirty ? (
          <span
            className="ml-1 size-1.5 shrink-0 rounded-full bg-amber"
            aria-label="Uncommitted changes inside"
          />
        ) : null}
      </button>
      {open ? (
        <ul role="group">
          <FolderRows
            repo={repo}
            rel={rel}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            deco={deco}
          />
        </ul>
      ) : null}
    </li>
  );
}

function FileRow({
  rel,
  name,
  depth,
  selected,
  onSelect,
  deco,
  max,
}: {
  rel: string;
  name: string;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  deco: Decorations;
  max: number;
}) {
  const { Icon } = fileIcon(name);
  const status = deco.status.get(rel);
  const change = deco.changes.get(rel);
  const act = deco.activity.get(rel);
  const owners = ownersFor(deco.owners as CodeownersRule[], rel);
  const tip = [
    act
      ? `${act.last_subject} — ${act.last_author}, ${age(new Date(act.last_time * 1000).toISOString())} ago · ${act.churn} commit${act.churn === 1 ? "" : "s"} in 90 days`
      : "",
    owners.length ? `owners: ${owners.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        title={tip || undefined}
        className={cn(
          "group flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left",
          selected ? "bg-raise text-ink" : "text-ink-2 hover:bg-raise/50 hover:text-ink",
        )}
        style={{ paddingLeft: 8 + depth * 14 + 16 }}
      >
        <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="mono min-w-0 flex-1 truncate text-[12px]">{name}</span>
        {owners[0] ? (
          <span className="hidden truncate text-[11px] text-ink-3 group-hover:inline">
            {owners[0]}
          </span>
        ) : null}
        {act ? (
          <span
            aria-label={`${act.churn} commits in 90 days`}
            className="size-1.5 shrink-0 rounded-full bg-ink"
            style={{ opacity: 0.2 + 0.8 * (act.churn / max) }}
          />
        ) : null}
        {change ? (
          <span className="tnum shrink-0 text-[11px]">
            {change.additions ? <span className="text-add">+{change.additions}</span> : null}{" "}
            {change.deletions ? <span className="text-del">−{change.deletions}</span> : null}
          </span>
        ) : null}
        {status ? (
          <span
            className={cn(
              "mono shrink-0 text-[10.5px]",
              status === "A" || status === "U"
                ? "text-add"
                : status === "D"
                  ? "text-del"
                  : "text-amber",
            )}
            aria-label={status === "U" ? "untracked" : "changed"}
          >
            {status}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

/** One file of the clone, read: code with line numbers, or the image itself. */
export function FilePreview({
  repo,
  rel,
  line,
  wrap,
}: { repo: string; rel: string; line?: number; wrap: boolean }) {
  const isImage = IMAGE.test(rel);
  const text = useEffectQuery(
    ["local-repo", repo, "file", rel],
    Effect.flatMap(Git, (g) => g.readFile(`${repo}/${rel}`)),
    { enabled: !isImage, staleTime: 30_000, retry: false },
  );
  const image = useEffectQuery(
    ["local-repo", repo, "image", rel],
    Effect.flatMap(Git, (g) => g.readFileDataUrl(`${repo}/${rel}`)),
    { enabled: isImage, staleTime: 5 * 60_000, retry: false },
  );
  const lang = useMemo(() => detectLanguage(rel), [rel]);
  const lines = useMemo(() => (text.data ?? "").split("\n"), [text.data]);
  if (isImage)
    return image.data ? (
      <div className="grid place-items-center rounded-lg bg-sink p-6">
        <img src={image.data} alt={rel} className="max-h-[480px] max-w-full rounded-md" />
      </div>
    ) : (
      <p className="px-3 py-2 text-[12.5px] text-ink-3">
        {image.isError ? "Can’t show this image." : "Loading the image…"}
      </p>
    );
  if (text.isError)
    return (
      <p className="px-3 py-2 text-[12.5px] text-ink-3">
        Can’t show this file: {String((text.error as Error).message)}
      </p>
    );
  if (!text.data) return <p className="px-3 py-2 text-[12.5px] text-ink-3">Reading…</p>;
  return (
    <div className={cn("max-h-[70vh] overflow-auto rounded-lg bg-sink scrollbar-thin")}>
      <table className="w-full border-collapse font-mono text-[12px] leading-[20px]" translate="no">
        <tbody>
          {lines.map((l, i) => (
            <tr
              key={`${i}-${l.length}`}
              id={line === i + 1 ? "file-line" : undefined}
              className={cn(line === i + 1 && "bg-raise")}
            >
              <td className="tnum w-[52px] select-none pr-3 text-right align-top text-[11px] text-ink-3">
                {i + 1}
              </td>
              <td
                className={cn(
                  "selectable pr-3 text-ink",
                  wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                )}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism output of the file's own text
                dangerouslySetInnerHTML={{ __html: highlightLine(l, lang) || " " }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
