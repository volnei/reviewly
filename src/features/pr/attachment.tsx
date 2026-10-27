import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { useEffectQuery } from "@/effect/runtime";
import { authStore } from "@/effect/services/Auth";
import { Tauri } from "@/effect/Tauri";
import { safeOpenUrl } from "@/lib/ui";

/**
 * GitHub serves what people drop into a pull request — screenshots, recordings —
 * only to a signed-in session, so the webview cannot load them by URL. The Rust
 * side fetches the bytes with the stored token and we show them as a data URL.
 */
export function isAttachmentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname === authStore.get().host || u.hostname === "github.com") {
    return (
      u.pathname.startsWith("/user-attachments/") ||
      /^\/[^/]+\/[^/]+\/assets\//.test(u.pathname) ||
      /^\/[^/]+\/[^/]+\/raw\//.test(u.pathname)
    );
  }
  return u.hostname.endsWith("githubusercontent.com");
}

const Fetched = Schema.Struct({
  content_type: Schema.String,
  data_b64: Schema.String,
  size: Schema.Number,
});

const fetchAttachment = (url: string) =>
  Effect.gen(function* () {
    const tauri = yield* Tauri;
    return yield* tauri.invoke("gh_fetch_attachment", { url }, Fetched);
  });

export function Attachment({ url, alt }: { url: string; alt?: string }) {
  const q = useEffectQuery(["attachment", url], fetchAttachment(url), {
    staleTime: 10 * 60_000,
  });
  if (q.isPending) {
    return (
      <span
        role="img"
        aria-label={alt ? `Loading ${alt}` : "Loading attachment"}
        className="my-2 block h-28 w-full max-w-[420px] animate-pulse rounded-md bg-raise"
      />
    );
  }
  if (q.isError || !q.data) {
    return (
      <span className="my-2 inline-flex items-center gap-2 rounded-md bg-sink px-2.5 py-1.5 text-[12px] text-ink-3">
        {alt || "An attachment"} didn't load.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => safeOpenUrl(url)}
          className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
        >
          Open on GitHub
        </button>
      </span>
    );
  }
  const src = `data:${q.data.content_type};base64,${q.data.data_b64}`;
  const type = q.data.content_type;
  if (type.startsWith("video/")) {
    return (
      <video src={src} controls className="my-2 max-w-full rounded-md border border-hair bg-sink">
        <track kind="captions" />
      </video>
    );
  }
  if (type.startsWith("audio/")) {
    // biome-ignore lint/a11y/useMediaCaption: a recording dropped into a PR has no caption track
    return <audio src={src} controls className="my-2 max-w-full" />;
  }
  if (type.startsWith("image/")) return <Zoomable src={src} alt={alt ?? ""} />;
  return (
    <button
      type="button"
      onClick={() => safeOpenUrl(url)}
      className="my-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-edge bg-card px-2.5 text-[12.5px] text-ink-2 hover:text-ink"
    >
      {alt || "Attachment"} <span className="tnum text-ink-3">{prettySize(q.data.size)}</span>
    </button>
  );
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The image at reading size; click for the whole thing on the void, click again to come back. */
function Zoomable({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={(props) => (
          <button
            type="button"
            {...props}
            className="my-2 block max-w-full cursor-zoom-in rounded-md border-0 bg-transparent p-0"
          >
            <img src={src} alt={alt} className="max-h-[520px] max-w-full rounded-md" />
          </button>
        )}
      />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-black/85 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-0 z-[70] flex items-center justify-center p-8 outline-none transition-[opacity,scale] duration-200 data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0">
          <DialogPrimitive.Close
            render={(props) => (
              <button
                type="button"
                {...props}
                className="absolute inset-0 cursor-zoom-out border-0 bg-transparent"
                aria-label="Close"
              />
            )}
          />
          <img
            src={src}
            alt={alt}
            className="relative max-h-[92vh] max-w-[92vw] rounded-md object-contain shadow-[0_8px_40px_rgba(0,0,0,.6)]"
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
