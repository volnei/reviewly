import {
  Braces,
  Database,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileLock2,
  FileTerminal,
  FileText,
  type LucideIcon,
  Package,
  Palette,
  ScrollText,
  Settings2,
} from "lucide-react";

interface IconSpec {
  Icon: LucideIcon;
  /** Tailwind text-color class tinting the glyph to the language's brand-ish hue. */
  className: string;
}

const DEFAULT: IconSpec = { Icon: FileText, className: "text-muted-foreground/55" };

// Exact filenames take priority over extensions.
const BY_NAME: Record<string, IconSpec> = {
  "package.json": { Icon: Package, className: "text-[#cb3837]" },
  "package-lock.json": { Icon: FileLock2, className: "text-muted-foreground/45" },
  "yarn.lock": { Icon: FileLock2, className: "text-muted-foreground/45" },
  "bun.lockb": { Icon: FileLock2, className: "text-muted-foreground/45" },
  "pnpm-lock.yaml": { Icon: FileLock2, className: "text-muted-foreground/45" },
  "cargo.lock": { Icon: FileLock2, className: "text-muted-foreground/45" },
  dockerfile: { Icon: FileCode2, className: "text-[#2496ed]" },
  ".gitignore": { Icon: Settings2, className: "text-muted-foreground/50" },
  ".gitattributes": { Icon: Settings2, className: "text-muted-foreground/50" },
  "biome.json": { Icon: Settings2, className: "text-[#60a5fa]" },
  "tsconfig.json": { Icon: FileCog, className: "text-[#3178c6]" },
};

const BY_EXT: Record<string, IconSpec> = {
  ts: { Icon: FileCode2, className: "text-[#3178c6]" },
  tsx: { Icon: FileCode2, className: "text-[#3178c6]" },
  mts: { Icon: FileCode2, className: "text-[#3178c6]" },
  cts: { Icon: FileCode2, className: "text-[#3178c6]" },
  js: { Icon: FileCode2, className: "text-[#eab308]" },
  jsx: { Icon: FileCode2, className: "text-[#eab308]" },
  mjs: { Icon: FileCode2, className: "text-[#eab308]" },
  cjs: { Icon: FileCode2, className: "text-[#eab308]" },
  rs: { Icon: FileCode2, className: "text-[#dea584]" },
  py: { Icon: FileCode2, className: "text-[#3572a5]" },
  go: { Icon: FileCode2, className: "text-[#00add8]" },
  rb: { Icon: FileCode2, className: "text-[#cc342d]" },
  java: { Icon: FileCode2, className: "text-[#e76f00]" },
  kt: { Icon: FileCode2, className: "text-[#a97bff]" },
  swift: { Icon: FileCode2, className: "text-[#f05138]" },
  php: { Icon: FileCode2, className: "text-[#777bb3]" },
  c: { Icon: FileCode2, className: "text-[#5c6bc0]" },
  h: { Icon: FileCode2, className: "text-[#5c6bc0]" },
  cpp: { Icon: FileCode2, className: "text-[#5c6bc0]" },
  json: { Icon: Braces, className: "text-[#cbcb41]" },
  jsonc: { Icon: Braces, className: "text-[#cbcb41]" },
  md: { Icon: FileText, className: "text-[#519aba]" },
  mdx: { Icon: FileText, className: "text-[#519aba]" },
  txt: { Icon: FileText, className: "text-muted-foreground/55" },
  css: { Icon: Palette, className: "text-[#38bdf8]" },
  scss: { Icon: Palette, className: "text-[#c6538c]" },
  less: { Icon: Palette, className: "text-[#1d365d]" },
  html: { Icon: FileCode2, className: "text-[#e34c26]" },
  vue: { Icon: FileCode2, className: "text-[#41b883]" },
  svelte: { Icon: FileCode2, className: "text-[#ff3e00]" },
  yml: { Icon: Settings2, className: "text-muted-foreground/60" },
  yaml: { Icon: Settings2, className: "text-muted-foreground/60" },
  toml: { Icon: Settings2, className: "text-muted-foreground/60" },
  ini: { Icon: Settings2, className: "text-muted-foreground/60" },
  env: { Icon: FileLock2, className: "text-[#eab308]/70" },
  sh: { Icon: FileTerminal, className: "text-[#4caf50]" },
  bash: { Icon: FileTerminal, className: "text-[#4caf50]" },
  zsh: { Icon: FileTerminal, className: "text-[#4caf50]" },
  sql: { Icon: Database, className: "text-[#38bdf8]" },
  prisma: { Icon: Database, className: "text-[#5a67d8]" },
  png: { Icon: FileImage, className: "text-[#d946ef]/70" },
  jpg: { Icon: FileImage, className: "text-[#d946ef]/70" },
  jpeg: { Icon: FileImage, className: "text-[#d946ef]/70" },
  gif: { Icon: FileImage, className: "text-[#d946ef]/70" },
  svg: { Icon: FileImage, className: "text-[#ffb13b]" },
  webp: { Icon: FileImage, className: "text-[#d946ef]/70" },
  ico: { Icon: FileImage, className: "text-[#d946ef]/70" },
  zip: { Icon: FileArchive, className: "text-muted-foreground/55" },
  tar: { Icon: FileArchive, className: "text-muted-foreground/55" },
  gz: { Icon: FileArchive, className: "text-muted-foreground/55" },
  lock: { Icon: FileLock2, className: "text-muted-foreground/45" },
  log: { Icon: ScrollText, className: "text-muted-foreground/50" },
};

/** Pick a tinted icon for a file by its name/extension (VS-Code-style). */
export function fileIcon(name: string): IconSpec {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith("readme")) return { Icon: FileText, className: "text-[#519aba]" };
  if (lower.startsWith(".env")) return { Icon: FileLock2, className: "text-[#eab308]/70" };
  if (lower.startsWith("license"))
    return { Icon: ScrollText, className: "text-muted-foreground/55" };
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  return BY_EXT[ext] ?? DEFAULT;
}
