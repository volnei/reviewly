/**
 * Minimal CODEOWNERS parser + matcher (GitHub semantics): patterns are
 * gitignore-like and the LAST matching rule wins. Good enough to surface "who
 * owns this path" in the file tree without pulling in a full glob engine.
 */
export interface CodeownersRule {
  pattern: string;
  owners: string[];
  re: RegExp;
}

function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const prefix = anchored ? "^" : "(^|.*/)";
  // Match the path itself or anything nested under it (so a dir rule covers files).
  return new RegExp(`${prefix}${re}(/.*)?$`);
}

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter((o) => o.startsWith("@") || o.includes("@"));
    if (!pattern || owners.length === 0) continue;
    try {
      rules.push({ pattern, owners, re: globToRegExp(pattern) });
    } catch {
      // Skip patterns we can't compile rather than breaking the whole file.
    }
  }
  return rules;
}

/** Owners for a repo-relative path — last matching rule wins, like GitHub. */
export function ownersFor(rules: CodeownersRule[], relPath: string): string[] {
  let match: string[] = [];
  for (const rule of rules) {
    if (rule.re.test(relPath)) match = rule.owners;
  }
  return match;
}
