import type { Hunk } from "@/lib/diff";
import { highlightLine } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Read-only renderer for a parsed unified diff (one file's hunks). Shared by
 * the local-repo Changes panel and the commit-diff in History. Pass
 * `showHunkHeaders` to keep the `@@ … @@` lines (useful across multi-hunk
 * commit diffs); omit it for a single-file working-tree diff.
 */
export function PatchView({
  hunks,
  lang,
  showHunkHeaders = false,
}: {
  hunks: Hunk[];
  lang: string;
  showHunkHeaders?: boolean;
}) {
  return (
    <div className="overflow-x-auto py-1 font-mono text-xs leading-[1.5]">
      {hunks.flatMap((h, hi) =>
        h.lines
          .filter((l) => showHunkHeaders || l.kind !== "hunk")
          .map((l, i) => (
            <div
              key={`${hi}-${i}`}
              className={cn(
                "flex",
                l.kind === "hunk" && "bg-info/[0.06] text-muted-foreground",
                l.kind === "add" && "bg-success/[0.08]",
                l.kind === "del" && "bg-destructive/[0.08]",
              )}
            >
              <span className="w-12 shrink-0 select-none px-2 text-right text-muted-foreground/40 tabular-nums">
                {l.kind === "hunk" ? "" : (l.newLine ?? l.oldLine ?? "")}
              </span>
              <span
                className={cn(
                  "w-3 shrink-0 text-center",
                  l.kind === "add" && "text-success",
                  l.kind === "del" && "text-destructive",
                )}
              >
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </span>
              <pre
                className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3 text-foreground/90"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism-highlighted
                dangerouslySetInnerHTML={{ __html: highlightLine(l.text, lang) || "&nbsp;" }}
              />
            </div>
          )),
      )}
    </div>
  );
}
