import { BookOpenCheck, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewSkill } from "@/effect/services/Prefs";
import { REVIEW_SKILL_TEMPLATES } from "@/lib/review-skills";
import { cn } from "@/lib/utils";

const id = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const draftLines = (value: string): string[] => value.split("\n");

const cleanLines = (value: ReadonlyArray<string>): string[] => [
  ...new Set(value.map((line) => line.trim()).filter(Boolean)),
];

export function ReviewSkillsEditor({
  skills,
  onChange,
}: {
  skills: ReadonlyArray<ReviewSkill>;
  onChange: (skills: ReviewSkill[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const update = (skillId: string, patch: Partial<ReviewSkill>) =>
    onChange(skills.map((skill) => (skill.id === skillId ? { ...skill, ...patch } : skill)));
  const add = (template?: (typeof REVIEW_SKILL_TEMPLATES)[number]) => {
    const skill: ReviewSkill = {
      id: id(),
      name: template?.name ?? "Custom review",
      enabled: true,
      repositories: [...(template?.repositories ?? [])],
      paths: [...(template?.paths ?? [])],
      instructions: template?.instructions ?? "",
    };
    onChange([...skills, skill]);
    setEditing(skill.id);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {REVIEW_SKILL_TEMPLATES.map((template) => (
          <Button
            key={template.name}
            variant="outline"
            size="sm"
            onClick={() => add(template)}
            disabled={skills.some((skill) => skill.name === template.name)}
          >
            <Plus aria-hidden />
            {template.name}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => add()}>
          <Plus aria-hidden />
          Custom skill
        </Button>
      </div>

      {skills.length ? (
        <div className="grid gap-2">
          {skills.map((skill) => {
            const open = editing === skill.id;
            const repositories = cleanLines(skill.repositories);
            const paths = cleanLines(skill.paths);
            const scope = [
              repositories.length
                ? `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`
                : "Every repository",
              paths.length
                ? `${paths.length} path ${paths.length === 1 ? "rule" : "rules"}`
                : "every changed path",
            ].join(" · ");
            return (
              <div key={skill.id} className="rounded-lg border border-edge bg-sink">
                <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <BookOpenCheck className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {skill.name.trim() || "Untitled skill"}
                    </p>
                    <p className="truncate text-[11px] text-ink-3">{scope}</p>
                  </div>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(enabled) => update(skill.id, { enabled })}
                    aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${open ? "Close" : "Edit"} ${skill.name}`}
                    onClick={() => setEditing(open ? null : skill.id)}
                  >
                    <ChevronDown
                      className={cn("transition-transform", open && "rotate-180")}
                      aria-hidden
                    />
                  </Button>
                </div>
                {open ? (
                  <div className="grid gap-4 border-t border-hair px-3 py-4">
                    <label className="grid gap-1.5 text-[11.5px] font-medium text-ink">
                      Name
                      <Input
                        size="sm"
                        value={skill.name}
                        onChange={(event) => update(skill.id, { name: event.target.value })}
                        placeholder="Security review"
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-1.5 text-[11.5px] font-medium text-ink">
                        Repositories
                        <span className="font-normal text-ink-3">
                          One glob per line. Empty applies everywhere.
                        </span>
                        <Textarea
                          rows={3}
                          value={skill.repositories.join("\n")}
                          onChange={(event) =>
                            update(skill.id, {
                              repositories: draftLines(event.target.value),
                            })
                          }
                          onBlur={() => update(skill.id, { repositories })}
                          placeholder={"volnei/reviewly\nwork/*"}
                          className="[&_textarea]:font-mono [&_textarea]:text-[11.5px]"
                        />
                      </label>
                      <label className="grid gap-1.5 text-[11.5px] font-medium text-ink">
                        Changed paths
                        <span className="font-normal text-ink-3">
                          Runs when at least one changed file matches.
                        </span>
                        <Textarea
                          rows={3}
                          value={skill.paths.join("\n")}
                          onChange={(event) =>
                            update(skill.id, {
                              paths: draftLines(event.target.value),
                            })
                          }
                          onBlur={() => update(skill.id, { paths })}
                          placeholder={"src/auth/**\n**/permissions/**"}
                          className="[&_textarea]:font-mono [&_textarea]:text-[11.5px]"
                        />
                      </label>
                    </div>
                    <label className="grid gap-1.5 text-[11.5px] font-medium text-ink">
                      Review instructions
                      <span className="font-normal text-ink-3">
                        Added only when this skill matches the pull request.
                      </span>
                      <Textarea
                        rows={5}
                        value={skill.instructions}
                        onChange={(event) => update(skill.id, { instructions: event.target.value })}
                        placeholder="What should the reviewer verify?"
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-del"
                        onClick={() => {
                          onChange(skills.filter(({ id: skillId }) => skillId !== skill.id));
                          setEditing(null);
                        }}
                      >
                        <Trash2 aria-hidden />
                        Delete skill
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-[11.5px] text-ink-3">
          No review skills yet. Add a focused playbook or create a repository-wide default.
        </p>
      )}
    </div>
  );
}
