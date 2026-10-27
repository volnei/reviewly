import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Attachment, isAttachmentUrl } from "./attachment";

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "id"],
  },
};

/** remark-gfm turns a bare URL into a link whose text is the URL itself. */
const isAutoLink = (href: string, children: ReactNode) =>
  children === href || (Array.isArray(children) && children.length === 1 && children[0] === href);

function A({ href, children }: ComponentPropsWithoutRef<"a">) {
  // A pasted screenshot or recording URL shows the media, as github.com does.
  if (href && isAttachmentUrl(href) && isAutoLink(href, children)) return <Attachment url={href} />;
  return (
    <a
      href={href}
      className="text-ink underline decoration-ink-3 underline-offset-2 hover:decoration-ink"
      onClick={(e) => {
        e.preventDefault();
        if (href) safeOpenUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function Img({ src, alt }: ComponentPropsWithoutRef<"img">) {
  if (typeof src === "string" && isAttachmentUrl(src)) return <Attachment url={src} alt={alt} />;
  return <img src={src} alt={alt ?? ""} />;
}

function Table({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="prose-table-wrap">
      <table {...props}>{children}</table>
    </div>
  );
}

/** GitHub-flavoured markdown, sanitised, in the page's own type. Links open outside. */
export function Markdown({
  children,
  className,
}: { children: string | null | undefined; className?: string }) {
  if (!children?.trim()) return null;
  return (
    <div className={cn("selectable prose-reviewly text-[13px] leading-[1.55] text-ink", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{ a: A, img: Img, table: Table }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
