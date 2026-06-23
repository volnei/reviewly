import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";

interface FetchedAttachment {
  content_type: string;
  data_b64: string;
  size: number;
}

interface Props {
  url: string;
  alt?: string;
}

/**
 * Render a GitHub-hosted attachment (user-attachments, raw, avatars) by
 * fetching it through Rust with the stored auth token. Picks
 * `<img>` or `<video>` based on the response content-type.
 */
export function GhAttachment({ url, alt }: Props) {
  const q = useQuery({
    queryKey: ["gh-attachment", url],
    queryFn: () => invoke<FetchedAttachment>("gh_fetch_attachment", { url }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const dataUrl = useMemo(() => {
    if (!q.data) return null;
    return `data:${q.data.content_type};base64,${q.data.data_b64}`;
  }, [q.data]);

  if (q.isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-background/30 px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading attachment…
      </span>
    );
  }

  if (q.error || !q.data || !dataUrl) {
    return (
      <span className="inline-flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
        <span>Failed to load attachment.</span>
        <Button size="xs" variant="ghost" onClick={() => safeOpenUrl(url)}>
          <ExternalLink className="size-3" />
          Open on GitHub
        </Button>
      </span>
    );
  }

  const type = q.data.content_type;
  if (type.startsWith("video/")) {
    return (
      <video
        src={dataUrl}
        controls
        className="my-2 max-w-full rounded-md border border-border/30 bg-background/30"
      >
        <track kind="captions" />
      </video>
    );
  }
  if (type.startsWith("audio/")) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: bot/PR attachments rarely have captions and this is a passthrough
      <audio src={dataUrl} controls className="my-2 max-w-full" />
    );
  }
  if (type.startsWith("image/")) {
    return <ZoomableImage src={dataUrl} alt={alt ?? ""} />;
  }

  // Unknown type — show a download-style link.
  return (
    <Button size="sm" variant="outline" onClick={() => safeOpenUrl(url)}>
      <ExternalLink className="size-3.5" />
      {alt || "Attachment"} ({prettySize(q.data.size)})
    </Button>
  );
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={(props) => (
          <button
            type="button"
            {...props}
            className="my-2 block cursor-zoom-in border-0 bg-transparent p-0"
          >
            <img src={src} alt={alt} className="max-w-full rounded-md" />
          </button>
        )}
      />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-0 z-[70] flex items-center justify-center p-8 outline-none transition-all duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <DialogPrimitive.Close
            render={(props) => (
              <button
                type="button"
                {...props}
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border/40 bg-popover/80 text-foreground backdrop-blur-md transition-colors hover:bg-popover"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            )}
          />
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
            className="relative max-h-[92vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** True if the URL points at a GitHub-hosted user attachment / media. */
export function isGhAttachmentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // github.com hosts user-attachments and per-repo /assets/ uploads.
  if (u.hostname === "github.com") {
    return (
      u.pathname.startsWith("/user-attachments/") ||
      // /<user>/<repo>/assets/<userid>/<uuid> — modern drag-drop format
      /^\/[^/]+\/[^/]+\/assets\//.test(u.pathname) ||
      // /<user>/<repo>/raw/... — raw blobs occasionally embedded
      /^\/[^/]+\/[^/]+\/raw\//.test(u.pathname)
    );
  }
  // user-images, private-user-images, raw, camo, media — all *.githubusercontent.com
  return u.hostname.endsWith("githubusercontent.com");
}
