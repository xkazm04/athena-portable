// The kit's coverage, over two populations that never share a number (ADR 0184).
//
// Node's own report is defined over the files a run imported, so a file no test can load (every
// React hook here: extensionless value imports node --test refuses) is not low, it is absent, and
// the headline is true and useless. This script fixes the population:
//
//   - the REPORT is the whole kit tree, derived from the filesystem (`listTree`), where a file no
//     test reaches is listed at 0% with its line count, and the reached-only figure is only ever
//     printed beside the whole-tree one, each labelled with how many files it is over;
//   - the GATE is a hand-kept set of pure modules in `coverage-floors.json`, each with a floor that
//     only rises (`ratchet`); a floored file below its floor, not reached, or gone from the tree
//     fails the run, so the gated population cannot shrink silently.
//
// Pure functions first; the CLI at the bottom reads the lcov file `pnpm test` writes, prints the
// table, applies the floors and exits non-zero on a failure. `--update` raises floors, never
// lowers one. Run from examples/demo-kit:  node scripts/coverage.ts [--update] [--lcov <file>]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface FileCoverage {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
}

export interface TreeFile {
  /** Repo-relative (kit-relative) POSIX path. */
  path: string;
  /** Executable lines, counted the way Node's lcov counts them: every source line. */
  lines: number;
}

export interface MergedFile extends FileCoverage {
  path: string;
  status: "reached" | "unreached";
}

export interface Floor {
  lines: number;
  branches: number;
}

export type Floors = Record<string, Floor>;

const toPosix = (p: string): string => p.replace(/\\/g, "/");
const isDrivePath = (p: string): boolean => /^[A-Za-z]:\//.test(p);

/** An lcov SF value (relative, Windows absolute, POSIX absolute or file:// URL) as a POSIX path relative to `root`. */
export function relativeTo(root: string, sf: string): string {
  let p = sf.trim();
  if (p.startsWith("file://")) {
    p = decodeURIComponent(new URL(p).pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  }
  p = toPosix(p);
  const base = toPosix(root).replace(/\/+$/, "");
  const absolute = p.startsWith("/") || isDrivePath(p);
  if (!absolute) return p.replace(/^\.\//, "");
  const fold = isDrivePath(p) || isDrivePath(base);
  const [pp, bb] = fold ? [p.toLowerCase(), base.toLowerCase()] : [p, base];
  return pp.startsWith(`${bb}/`) ? p.slice(base.length + 1) : p;
}

/** Per-file line and branch totals from an lcov document, keyed by POSIX path relative to `root`. */
export function parseLcov(text: string, root: string): Record<string, FileCoverage> {
  const out: Record<string, FileCoverage> = {};
  let current: FileCoverage | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    const key = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1);
    if (key === "SF") {
      current = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0 };
      out[relativeTo(root, value)] = current;
    } else if (current && key === "LF") current.linesFound = Number(value);
    else if (current && key === "LH") current.linesHit = Number(value);
    else if (current && key === "BRF") current.branchesFound = Number(value);
    else if (current && key === "BRH") current.branchesHit = Number(value);
    else if (key === "end_of_record") current = null;
  }
  return out;
}

/** Lines in a source file as Node's coverage counts them (a trailing newline ends a line, it does not start one). */
export function countLines(source: string): number {
  if (source === "") return 0;
  const lines = source.split(/\r?\n/);
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

const isSource = (name: string, tsx: boolean): boolean =>
  !name.endsWith(".d.ts") && (name.endsWith(".ts") || (tsx && name.endsWith(".tsx")));

/**
 * The report's population, from the filesystem: `src/**\/*.ts(x)`, `template/lib/*.ts` and the
 * kit's root-level `*.ts` (the adopt CLI). Never `test/`, `scripts/`, `node_modules/` or `*.d.ts`.
 * A file created anywhere in that shape is in the next report with no config edit.
 */
export function listTree(root: string): TreeFile[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/${entry.name}`);
      else if (entry.isFile() && isSource(entry.name, true)) found.push(`${rel}/${entry.name}`);
    }
  };
  walk(join(root, "src"), "src");
  const flat = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && isSource(entry.name, false)) found.push(rel ? `${rel}/${entry.name}` : entry.name);
    }
  };
  flat(join(root, "template", "lib"), "template/lib");
  flat(root, "");
  return found.sort().map((path) => ({ path, lines: countLines(readFileSync(join(root, path), "utf8")) }));
}

/** Every tree file, with its lcov record or, when the run never loaded it, at 0 of its line count. */
export function mergeScope(records: Record<string, FileCoverage>, tree: readonly TreeFile[]): MergedFile[] {
  return tree.map(({ path, lines }) => {
    const rec = records[path];
    if (rec) return { path, status: "reached" as const, ...rec };
    return { path, status: "unreached" as const, linesFound: lines, linesHit: 0, branchesFound: 0, branchesHit: 0 };
  });
}

const pct = (hit: number, found: number): number => (found === 0 ? 100 : (hit / found) * 100);
export const linePct = (f: FileCoverage): number => pct(f.linesHit, f.linesFound);
export const branchPct = (f: FileCoverage): number => pct(f.branchesHit, f.branchesFound);

export interface Figure {
  pct: number;
  files: number;
  of: number;
  /** e.g. "45.0% lines over 2 of 2 files" - a figure never travels without its population. */
  label: string;
}

/** The whole-tree figure and the reached-only figure, each carrying the population it is over. */
export function headline(merged: readonly MergedFile[]): { whole: Figure; reached: Figure; text: string } {
  const figure = (rows: readonly MergedFile[]): Figure => {
    const found = rows.reduce((s, r) => s + r.linesFound, 0);
    const hit = rows.reduce((s, r) => s + r.linesHit, 0);
    const value = pct(hit, found);
    return {
      pct: value,
      files: rows.length,
      of: merged.length,
      label: `${value.toFixed(1)}% lines over ${rows.length} of ${merged.length} files`,
    };
  };
  const whole = figure(merged);
  const reached = figure(merged.filter((r) => r.status === "reached"));
  return { whole, reached, text: `whole tree: ${whole.label}  |  reached only: ${reached.label}` };
}

/** The floors applied: every failure named, a missing or stale file failing rather than being skipped. */
export function gate(floors: Floors, merged: readonly MergedFile[]): { ok: boolean; failures: string[] } {
  const byPath = new Map(merged.map((m) => [m.path, m]));
  const failures: string[] = [];
  for (const [path, floor] of Object.entries(floors)) {
    const m = byPath.get(path);
    if (!m) {
      failures.push(`stale floor: ${path} is no longer in the tree`);
      continue;
    }
    if (m.status === "unreached") {
      failures.push(`floored file not reached: ${path} (floor ${floor.lines}% lines) was not loaded by the run`);
      continue;
    }
    const lines = linePct(m);
    const branches = branchPct(m);
    if (lines < floor.lines) failures.push(`${path}: lines ${lines.toFixed(2)}% below floor ${floor.lines}%`);
    if (branches < floor.branches) {
      failures.push(`${path}: branches ${branches.toFixed(2)}% below floor ${floor.branches}%`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Raise each floor to floor(actual) where the run measured higher; never lower one. A floor above
 * the measured figure is reported in `above` (the gate already fails it) and left as written.
 */
export function ratchet(
  floors: Floors,
  merged: readonly MergedFile[],
): { floors: Floors; raised: string[]; above: string[] } {
  const byPath = new Map(merged.map((m) => [m.path, m]));
  const next: Floors = {};
  const raised: string[] = [];
  const above: string[] = [];
  for (const [path, floor] of Object.entries(floors)) {
    const m = byPath.get(path);
    if (!m || m.status === "unreached") {
      next[path] = { ...floor };
      continue;
    }
    const lines = Math.floor(linePct(m));
    const branches = Math.floor(branchPct(m));
    const out = { lines: Math.max(floor.lines, lines), branches: Math.max(floor.branches, branches) };
    if (out.lines > floor.lines || out.branches > floor.branches) {
      raised.push(`${path}: ${floor.lines}/${floor.branches} -> ${out.lines}/${out.branches}`);
    }
    if (floor.lines > lines || floor.branches > branches) {
      above.push(`${path}: floor ${floor.lines}/${floor.branches} is above measured ${lines}/${branches}`);
    }
    next[path] = out;
  }
  return { floors: next, raised, above };
}

/** The whole-tree table: unreached files sorted first, by size, so the biggest blind spot leads. */
export function table(merged: readonly MergedFile[]): string {
  const rows = [...merged].sort((a, b) =>
    a.status === b.status ? b.linesFound - a.linesFound || a.path.localeCompare(b.path) : a.status === "unreached" ? -1 : 1,
  );
  const width = Math.max(4, ...rows.map((r) => r.path.length));
  const lines = [`${"file".padEnd(width)}  line %  branch %  lines  status`];
  for (const r of rows) {
    const branch = r.status === "unreached" ? "     -" : branchPct(r).toFixed(2).padStart(6);
    lines.push(
      `${r.path.padEnd(width)}  ${linePct(r).toFixed(2).padStart(6)}    ${branch}  ${String(r.linesFound).padStart(5)}  ${r.status}`,
    );
  }
  return lines.join("\n");
}

export interface FloorsFile {
  $comment: string;
  floors: Floors;
}

export const FLOORS_COMMENT =
  "Written by `node scripts/coverage.ts --update`, which only ever raises a floor. Percent, floored. The gated set is the kit's pure modules (ADR 0184); add a path by hand, never lower a number.";

export const DEFAULT_LCOV = "node_modules/.demo-kit-coverage.lcov";

function main(argv: readonly string[]): number {
  const kit = join(dirname(fileURLToPath(import.meta.url)), "..");
  const lcovArg = argv.indexOf("--lcov");
  const lcovFile = join(kit, lcovArg === -1 ? DEFAULT_LCOV : (argv[lcovArg + 1] ?? DEFAULT_LCOV));
  if (!existsSync(lcovFile)) {
    console.error(`coverage: no lcov at ${lcovFile} - run \`pnpm --filter @athena/demo-kit test\` first`);
    return 1;
  }
  const merged = mergeScope(parseLcov(readFileSync(lcovFile, "utf8"), kit), listTree(kit));
  const floorsPath = join(kit, "scripts", "coverage-floors.json");
  const file = JSON.parse(readFileSync(floorsPath, "utf8")) as FloorsFile;

  console.log("\ndemo-kit coverage - the whole tree; a file no test loads is listed at 0%\n");
  console.log(table(merged));
  console.log(`\n${headline(merged).text}`);

  const { floors, raised, above } = ratchet(file.floors, merged);
  for (const a of above) console.log(`floor above measured (left as written): ${a}`);
  if (argv.includes("--update")) {
    writeFileSync(floorsPath, `${JSON.stringify({ $comment: FLOORS_COMMENT, floors }, null, 2)}\n`);
    console.log(raised.length ? `raised:\n  ${raised.join("\n  ")}` : "no floor could rise");
  } else if (raised.length) {
    console.log(`${raised.length} floor(s) can rise - \`node scripts/coverage.ts --update\``);
  }

  const result = gate(file.floors, merged);
  const n = Object.keys(file.floors).length;
  if (!result.ok) {
    console.error(`\ncoverage gate FAILED over ${n} floored pure modules:\n  ${result.failures.join("\n  ")}`);
    return 1;
  }
  console.log(`coverage gate: ${n} floored pure modules at or above their floors`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
