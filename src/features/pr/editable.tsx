import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Composer } from "./thread";

/** The title, and a pencil on hover when it is yours. ↵ saves, esc leaves it. */
export function EditableTitle({
  title,
  canEdit,
  onSave,
}: { title: string; canEdit: boolean; onSave: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <h1 className="group selectable flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em] text-ink">
        {title}
        {canEdit ? (
          <button
            type="button"
            aria-label="Edit title"
            onClick={() => {
              setValue(title);
              setEditing(true);
            }}
            className="grid size-6 place-items-center rounded-md text-ink-3 opacity-0 hover:bg-raise hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </h1>
    );
  }
  const save = async () => {
    const t = value.trim();
    if (!t || t === title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(t);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <input
      autoFocus
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void save();
        if (e.key === "Escape") setEditing(false);
      }}
      className="selectable h-8 w-full max-w-[760px] rounded-md border border-edge bg-sink px-2 text-[20px] font-semibold tracking-[-0.02em] text-ink outline-none"
    />
  );
}

/** The description, with "Edit description" under it when it is yours. */
export function EditableBody({
  body,
  canEdit,
  onSave,
  children,
}: {
  body: string | null;
  canEdit: boolean;
  onSave: (body: string) => Promise<void>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="min-w-0 w-full">
        <Composer
          placeholder="What this change is, and why."
          submitLabel="Save"
          initial={body ?? ""}
          onSubmit={async (b) => {
            await onSave(b);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <div className="min-w-0 w-full">
      {children}
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 h-6 rounded-md px-1.5 text-[12px] text-ink-3 hover:bg-raise hover:text-ink"
        >
          {body?.trim() ? "Edit description" : "Add a description"}
        </button>
      ) : null}
    </div>
  );
}
