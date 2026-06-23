import { LabelChip } from "@/components/label-chip";
import { PopoverPanel } from "@/components/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/tauri";
import type { Label } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface Props {
  owner: string;
  repo: string;
  number: number;
  current: Label[];
  /** Called after labels list changes so the page can refresh its cache. */
  onChange?: (labels: Label[]) => void;
}

export function LabelPicker({ owner, repo, number, current, onChange }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const all = useQuery({
    queryKey: ["repo-labels", owner, repo],
    queryFn: () => invoke<Label[]>("gh_repo_labels", { owner, repo }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const setLabels = useMutation({
    mutationFn: (names: string[]) =>
      invoke<Label[]>("gh_set_pr_labels", { owner, repo, number, labels: names }),
    onSuccess: (labels) => {
      onChange?.(labels);
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["pull", owner, repo, number] });
    },
    onError: (e) => toast.error(`Couldn't update labels: ${e}`),
  });

  const currentNames = new Set(current.map((l) => l.name));
  const list = useMemo(() => {
    const data = all.data ?? [];
    const f = filter.trim().toLowerCase();
    return f ? data.filter((l) => l.name.toLowerCase().includes(f)) : data;
  }, [all.data, filter]);

  function toggle(name: string) {
    const next = new Set(currentNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setLabels.mutate([...next]);
  }

  return (
    <div className="relative inline-flex flex-wrap items-center gap-1.5">
      {current.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}

      <Button
        size="icon-xs"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add or remove labels"
      >
        <Plus className="size-3.5" />
      </Button>

      {open && (
        <PopoverPanel onClose={() => setOpen(false)} align="left" width="w-64">
          <Input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter labels…"
            size="sm"
            className="mb-1.5 w-full"
          />
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {all.isLoading ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>
            ) : list.length === 0 ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">No labels.</li>
            ) : (
              list.map((l) => {
                const selected = currentNames.has(l.name);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => toggle(l.name)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.04]"
                    >
                      <Check
                        className={cn("size-3 shrink-0", selected ? "text-primary" : "opacity-0")}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `#${(l.color || "888888").replace(/^#/, "")}` }}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "shrink-0 truncate",
                          selected ? "text-foreground" : "text-foreground/90",
                        )}
                      >
                        {l.name}
                      </span>
                      {l.description && (
                        <span className="ml-2 truncate text-muted-foreground">{l.description}</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="mt-1.5 flex items-center justify-end gap-1.5 border-t border-border/30 pt-1.5">
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
