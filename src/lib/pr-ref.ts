/**
 * A pull request named by hand: a github.com URL (any tab, anchor or query
 * string after the number) or the `owner/repo#123` shorthand.
 */
export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export function parsePrRef(text: string): PrRef | null {
  const t = text.trim();
  if (!t) return null;
  const url = t.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  const short = t.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) };
  return null;
}
