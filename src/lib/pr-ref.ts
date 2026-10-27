/**
 * A pull request named by hand: a GitHub URL (any host, tab, anchor or query
 * string after the number) or the `owner/repo#123` shorthand.
 */
export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export function parsePrRef(text: string, allowedHost?: string): PrRef | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const parsed = new URL(t);
    const url = parsed.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/i);
    if (url && (!allowedHost || parsed.hostname === allowedHost)) {
      return { owner: url[1], repo: url[2], number: Number(url[3]) };
    }
  } catch {
    // The owner/repo#number shorthand below is not a URL.
  }
  const short = t.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) };
  return null;
}
