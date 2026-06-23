import { GhAttachment, isGhAttachmentUrl } from "@/components/gh-attachment";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Children, type ComponentPropsWithoutRef, type ReactNode, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface Props {
  children: string | null | undefined;
  className?: string;
}

// Allow GitHub-flavored details/summary and the usual rehype-sanitize defaults.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "id"],
  },
};

function ExternalLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  // remark-gfm autolinks bare URLs as `<a href="X">X</a>`. When that URL is a
  // GitHub user-attachment (image or video), render the actual media instead
  // so users see the screenshot/recording inline like on github.com.
  if (href && isGhAttachmentUrl(href) && isAutoLink(href, children)) {
    return <GhAttachment url={href} />;
  }
  return (
    <a
      {...rest}
      href={href ?? "#"}
      onClick={(e) => {
        e.preventDefault();
        if (href) safeOpenUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function isAutoLink(href: string, children: ReactNode): boolean {
  const kids = Children.toArray(children);
  if (kids.length !== 1) return false;
  const only = kids[0];
  if (typeof only === "string") return only === href;
  if (isValidElement(only)) return false;
  return false;
}

function MarkdownImage({ src, alt }: ComponentPropsWithoutRef<"img">) {
  if (typeof src === "string" && isGhAttachmentUrl(src)) {
    return <GhAttachment url={src} alt={alt} />;
  }
  return <img src={src} alt={alt ?? ""} />;
}

const components = {
  a: ExternalLink,
  img: MarkdownImage,
};

/**
 * Render a GitHub-style markdown body (review body, comment, issue) with
 * the project's `.prose-reviewly` theme. Supports embedded HTML like
 * `<details>` blocks, silently drops HTML comments, routes all link
 * clicks to the OS browser, and proxies GitHub-hosted media through Rust
 * with our auth token so screenshots/videos load.
 */
export function MarkdownBody({ children, className }: Props) {
  if (!children) return null;
  return (
    <div className={cn("prose-reviewly", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
