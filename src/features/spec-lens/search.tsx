import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runtime } from "@/effect/runtime";
import { providerName } from "@/effect/services/Ai";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { useAiRun } from "@/features/pr/ai";
import { Markdown } from "@/features/pr/markdown";
import { toLocalId } from "@/lib/local-id";
import { recoveryHint } from "@/lib/reliability";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ChevronRight,
  FileText,
  Search,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import {
  type SpecSource,
  buildSpecSearchPrompt,
  parseSpecSearchAnswer,
  specSourceFiles,
} from "./ai";
import { SpecComposer } from "./composer";
import type { SpecWorkspace } from "./model";

const STARTERS = [
  "What rules govern authentication?",
  "Where do our current specs contradict each other?",
];

export function SpecSearch({ workspace }: { workspace: SpecWorkspace }) {
  const [question, setQuestion] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [mode, setMode] = useState<"create" | "search">("create");
  const [loadError, setLoadError] = useState<string | null>(null);
  const ai = useAiRun();
  const navigate = useNavigate();
  const provider = usePrefs((prefs) => prefs.ai.provider);
  const files = useMemo(() => specSourceFiles(workspace), [workspace]);
  const result =
    ai.text && !ai.running ? parseSpecSearchAnswer(ai.text, files) : null;
  const creating = mode === "create";

  const ask = async (value = question) => {
    const query = value.trim();
    if (!query || ai.running || loadingFiles) return;
    setQuestion(query);
    setLoadError(null);
    setLoadingFiles(true);
    try {
      const sources = await runtime.runPromise(
        Effect.flatMap(Git, (git) =>
          Effect.forEach(
            files,
            (file) =>
              git.readFile(`${workspace.path}/${file}`).pipe(
                Effect.map(
                  (content) => ({ path: file, content }) satisfies SpecSource,
                ),
                Effect.orElseSucceed(() => null),
              ),
            { concurrency: 4 },
          ),
        ),
      );
      const readable = sources.filter(
        (source): source is SpecSource => source !== null,
      );
      if (!readable.length) {
        setLoadError("Reviewly couldn’t read this change’s OpenSpec files.");
        return;
      }
      ai.start(
        `spec-lens:${workspace.path}:app-specs`,
        buildSpecSearchPrompt(workspace, query, readable),
        undefined,
        `Searching ${workspace.repo} specs`,
        workspace.path,
      );
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Couldn’t read the OpenSpec files.",
      );
    } finally {
      setLoadingFiles(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask();
  };

  const openFile = (file: string) => {
    void navigate({
      to: "/local/$id",
      params: { id: toLocalId(workspace.path) },
      search: { file, from: "spec-lens" },
    });
  };

  return (
    <section
      className="mb-5 border-y border-hair bg-sink/35 px-5 py-4"
      aria-labelledby="spec-ai-title"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {creating ? (
            <WandSparkles className="ai-spark size-3.5" />
          ) : (
            <Sparkles className="ai-spark size-3.5" />
          )}
          <h3 id="spec-ai-title" className="text-[12px] font-medium text-ink">
            {creating ? "Create app spec" : "Search app specs"}
          </h3>
          <span className="text-[10.5px] text-ink-3">
            {providerName(provider)} · {files.length} current spec
            {files.length === 1 ? "" : "s"}
          </span>
        </div>
        {ai.running ? (
          <button
            type="button"
            onClick={ai.cancel}
            className="flex items-center gap-1 text-[10.5px] text-ink-3 hover:text-ink"
          >
            <X className="size-3" /> Stop
          </button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setMode(creating ? "search" : "create")}
          >
            {creating ? (
              <>
                <Search className="size-3.5" /> Search app specs
              </>
            ) : (
              <>
                <WandSparkles className="size-3.5" /> Create spec with AI
              </>
            )}
          </Button>
        )}
      </div>

      {creating ? (
        <SpecComposer workspace={workspace} onClose={() => setMode("search")} />
      ) : null}

      {!creating ? (
        <form onSubmit={submit} className="mt-2.5 flex gap-2">
          <Input
            nativeInput
            type="search"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Search every current rule in the app…"
            aria-label="Search all current OpenSpec rules"
            className="max-w-3xl flex-1 bg-page"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!question.trim()}
            loading={loadingFiles || ai.running}
          >
            <Search className="size-3.5" /> Search
          </Button>
        </form>
      ) : null}

      {!creating && !ai.text && !ai.running && !loadError ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[10.5px] text-ink-3">Try</span>
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => void ask(starter)}
              className="text-[10.5px] text-ink-2 underline decoration-hair underline-offset-3 hover:text-ink hover:decoration-ink-3"
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}

      {!creating && (loadingFiles || ai.running) ? (
        <p
          className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-3"
          aria-live="polite"
        >
          <span className="ai-dot size-1.5 animate-pulse rounded-full" />
          {loadingFiles
            ? "Reading OpenSpec artifacts…"
            : `Searching with ${providerName(provider)}…`}
        </p>
      ) : null}

      {!creating && result ? (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(190px,280px)] gap-6 border-t border-hair pt-4 max-[880px]:grid-cols-1">
          <Markdown className="text-[12.5px]">{result.answer}</Markdown>
          <div>
            <p className="mb-1.5 text-[10.5px] font-medium text-ink-3">
              Evidence
            </p>
            {result.sources.length ? (
              <div className="border-y border-hair">
                {result.sources.map((source) => (
                  <button
                    key={source.path}
                    type="button"
                    onClick={() => openFile(source.path)}
                    className="group flex w-full items-start gap-2 border-b border-hair px-1 py-2 text-left last:border-b-0 hover:bg-raise/35"
                  >
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10px] text-ink-2">
                        {source.path}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-3">
                        {source.reason}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-3 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10.5px] leading-4 text-ink-3">
                The model returned no valid file references. Its answer is
                shown, but not treated as grounded evidence.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {!creating && (loadError || ai.error) ? (
        <div className="mt-3 text-[11.5px]">
          <p className="text-del">{loadError ?? ai.error}</p>
          {ai.error ? (
            <p className="mt-1 text-ink-3">{recoveryHint(ai.error)}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
