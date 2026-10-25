/**
 * Adopt the template: `node examples/demo-kit/adopt.ts <name> --port N --design D [--title T]
 * [--tagline T] [--dry-run]`.
 *
 * The template's author is absent when someone copies it, so everything they would ask is carried
 * here as data (ADR 0170): the answers, one deterministic mapping from answers to file edits, a
 * readiness gate whose every refusal names its prerequisite and its remedy, a copy staged beside
 * the target and renamed into place only when every file landed, and a stamp (`.template.json`)
 * recording the template's digest and the answers. The stamp couples nothing: the instance owes
 * the template nothing after adoption, the stamp only says where it came from.
 *
 * It edits no shared file. The root `package.json` `dev:<app>` line is printed as a next step.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The template this kit ships, and the examples directory a copy of it lands in. */
export const TEMPLATE_DIR = join(HERE, "template");
export const EXAMPLES_DIR = resolve(HERE, "..");
const TEMPLATE_ID = "@athena/demo-kit/template";
const STAMP_FILE = ".template.json";

/**
 * The template's identity, as it spells it. No file of an adopted instance may contain one: the
 * mapping below replaces each, and an adoption that would leave one is a template defect (a new
 * literal the mapping does not know), so it throws before anything is written.
 */
export const IDENTITY_TOKENS: readonly string[] = ["demo-app", "Demo app", "copy me", '"plain"', 'data-variant="plain"'];

export interface Answers {
  /** The package and directory name: lower-case letters, digits and hyphens. */
  name: string;
  /** The dev server's port; no sibling under the examples root may hold it. */
  port: number;
  /** The design's name: the `[data-variant]` block and `VARIANT`. */
  design: string;
  /** What the shell and the page title call the app. Default: the name, capitalised. */
  title?: string;
  tagline?: string;
}

export interface AdoptOptions {
  /** The examples directory the instance lands in. Default: the one beside this kit. */
  root?: string;
  /** The template to copy. Default: the kit's own. */
  template?: string;
  /** Answer the edits and write nothing. */
  dryRun?: boolean;
  /** Test seam: throw once this many files have been written to the staging copy. */
  failAfter?: number;
}

export interface Edit {
  file: string;
  before: string;
  after: string;
}

export interface Stamp {
  template: string;
  digest: string;
  answers: Required<Answers>;
}

export type Prerequisite = "node" | "template" | "name" | "directory" | "port" | "design" | "title";

export type Adoption =
  | { ok: true; target: string; dryRun: boolean; edits: Edit[]; stamp: Stamp; next: string[] }
  | { ok: false; prerequisite: Prerequisite; error: string; remedy: string };

const SKIP_DIRS = new Set(["node_modules", ".next", "data"]);
const SKIP_FILES = new Set(["next-env.d.ts", STAMP_FILE]);

/** The template's payload: every file a copy carries, as sorted posix paths. Build output excluded. */
export function payloadFiles(template: string = TEMPLATE_DIR): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
      } else if (!SKIP_FILES.has(entry.name) && !entry.name.endsWith(".tsbuildinfo")) {
        out.push(relative(template, path).replaceAll("\\", "/"));
      }
    }
  };
  walk(template);
  return out.sort();
}

/** sha256 over the sorted payload: each file's path and bytes, so a rename or one byte moves it. */
export function templateDigest(template: string = TEMPLATE_DIR): string {
  const hash = createHash("sha256");
  for (const file of payloadFiles(template)) {
    hash.update(file);
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(join(template, file))).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** Every port a sibling's dev script names (`--port N` or `-p N`), from examples/<app>/package.json. */
export function siblingPorts(root: string): Map<number, string> {
  const held = new Map<number, string>();
  if (!existsSync(root)) return held;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(root, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    let scripts: Record<string, unknown> = {};
    try {
      scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {};
    } catch {
      continue;
    }
    for (const script of Object.values(scripts)) {
      if (typeof script !== "string") continue;
      for (const m of script.matchAll(/(?:--port[ =]|-p )(\d+)/g)) held.set(Number(m[1]), entry.name);
    }
  }
  return held;
}

const NAME_RULE = /^[a-z][a-z0-9-]{0,49}$/;
const DESIGN_RULE = /^[a-z][a-z0-9-]{0,31}$/;

function titleFor(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

type Refusal = Extract<Adoption, { ok: false }>;
const refuse = (prerequisite: Prerequisite, error: string, remedy: string): Refusal => ({
  ok: false,
  prerequisite,
  error,
  remedy,
});

/** The readiness gate: every prerequisite, checked before anything is read for copying or written. */
function readiness(answers: Answers, root: string, template: string): Refusal | null {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    return refuse("node", `Node ${process.versions.node} has no node:sqlite.`, "Use Node 22.5 or newer.");
  }
  if (!existsSync(join(template, "package.json"))) {
    return refuse("template", `No template at ${template}.`, "Run from a checkout that has examples/demo-kit/template.");
  }
  const { name, port, design } = answers;
  if (typeof name !== "string" || !NAME_RULE.test(name)) {
    return refuse(
      "name",
      `"${String(name)}" is not a package name this workspace accepts.`,
      "Pick a name of lower-case letters, digits and hyphens that starts with a letter, e.g. parcelbay.",
    );
  }
  if (existsSync(join(root, name))) {
    return refuse(
      "directory",
      `examples/${name} already exists.`,
      "Pick a name no directory under examples/ has; adoption never writes into an existing one.",
    );
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return refuse("port", `Port ${String(port)} is not a usable dev port.`, "Pass a whole number from 1024 to 65535.");
  }
  const held = siblingPorts(root);
  const holder = held.get(port);
  if (holder) {
    let free = port + 1;
    while (held.has(free)) free += 1;
    return refuse(
      "port",
      `Port ${port} is held by ${holder} (its package.json dev script); the first free port from ${port} is ${free}.`,
      `Pass --port ${free}, so every app can run at once.`,
    );
  }
  if (typeof design !== "string" || !DESIGN_RULE.test(design)) {
    return refuse(
      "design",
      `"${String(design)}" cannot name a [data-variant] block.`,
      "Name the design in lower-case letters, digits and hyphens, e.g. ink.",
    );
  }
  for (const [field, value] of [["title", answers.title], ["tagline", answers.tagline]] as const) {
    if (value !== undefined && (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value))) {
      return refuse("title", `The ${field} must be one non-empty line.`, `Pass --${field} "<one line>" or leave it out.`);
    }
  }
  return null;
}

/** One replacement that must land exactly once: a miss means the template drifted from the mapping. */
interface Rule {
  file: string;
  find: RegExp;
  to: string;
}

function rulesFor(a: Required<Answers>): Rule[] {
  const lit = (s: string) => JSON.stringify(s);
  return [
    { file: "package.json", find: /"name": "demo-app"/, to: `"name": ${lit(a.name)}` },
    { file: "package.json", find: /next dev --port \d+/, to: `next dev --port ${a.port}` },
    { file: "lib/constants.ts", find: /^export const APP_ID = .*;$/m, to: `export const APP_ID = ${lit(a.name)};` },
    { file: "lib/constants.ts", find: /^export const APP_NAME = .*;$/m, to: `export const APP_NAME = ${lit(a.title)};` },
    { file: "lib/constants.ts", find: /^export const TAGLINE = .*;$/m, to: `export const TAGLINE = ${lit(a.tagline)};` },
    { file: "lib/constants.ts", find: /^export const VARIANT = .*;$/m, to: `export const VARIANT = ${lit(a.design)};` },
    { file: "app/globals.css", find: /\[data-variant="plain"\]/, to: `[data-variant="${a.design}"]` },
    { file: "app/globals.css", find: /^ \* Demo app - /m, to: ` * ${a.title} - ` },
  ];
}

/** The mapping: answers to edits, pure. Throws when a rule misses or a token survives. */
function mapEdits(template: string, answers: Required<Answers>, files: string[]): Edit[] {
  const after = new Map<string, string>();
  const before = new Map<string, string>();
  for (const rule of rulesFor(answers)) {
    if (!before.has(rule.file)) before.set(rule.file, readFileSync(join(template, rule.file), "utf8"));
    const text = after.get(rule.file) ?? before.get(rule.file)!;
    const hits = text.match(new RegExp(rule.find.source, `${rule.find.flags}g`))?.length ?? 0;
    if (hits !== 1) throw new Error(`template drifted: ${rule.file} matches ${rule.find} ${hits} times, not once`);
    after.set(rule.file, text.replace(rule.find, () => rule.to));
  }
  for (const file of files) {
    const text = after.get(file) ?? readFileSync(join(template, file), "utf8");
    const leak = IDENTITY_TOKENS.find((t) => text.includes(t));
    if (leak) throw new Error(`template drifted: ${file} spells the template's identity (${leak}) and the mapping does not replace it`);
  }
  return [...after].map(([file, text]) => ({ file, before: before.get(file)!, after: text })).sort((x, y) => (x.file < y.file ? -1 : 1));
}

/**
 * Adopt the template into `<root>/<name>`. A refusal is returned; an I/O failure mid-copy removes
 * the staging copy and is thrown. Either way nothing is left under the root but a whole instance.
 */
export function adopt(answers: Answers, options: AdoptOptions = {}): Adoption {
  const root = resolve(options.root ?? EXAMPLES_DIR);
  const template = resolve(options.template ?? TEMPLATE_DIR);
  const blocked = readiness(answers, root, template);
  if (blocked) return blocked;

  const full: Required<Answers> = {
    name: answers.name,
    port: answers.port,
    design: answers.design,
    title: answers.title ?? titleFor(answers.name),
    tagline: answers.tagline ?? "A host app for the Athena examples. Ships without Athena.",
  };
  const files = payloadFiles(template);
  const edits = mapEdits(template, full, files);
  const stamp: Stamp = { template: TEMPLATE_ID, digest: templateDigest(template), answers: full };
  const target = join(root, full.name);
  const next = [
    "pnpm install",
    `pnpm --filter ${full.name} typecheck && pnpm --filter ${full.name} lint && pnpm --filter ${full.name} build`,
    `add "dev:${full.name}": "pnpm --filter ${full.name} dev" to the root package.json`,
    `pnpm --filter ${full.name} dev   # http://localhost:${full.port}`,
    "then the domain work in the instance's README: types and seed, capabilities, actions",
  ];
  if (options.dryRun) return { ok: true, target, dryRun: true, edits, stamp, next };

  const edited = new Map(edits.map((e) => [e.file, e.after]));
  const staging = join(root, `.adopt-${full.name}-${randomBytes(4).toString("hex")}`);
  let written = 0;
  const write = (file: string, data: string | Buffer) => {
    if (options.failAfter !== undefined && written >= options.failAfter) {
      throw new Error(`injected failure after ${written} files`);
    }
    const path = join(staging, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    written += 1;
  };
  try {
    mkdirSync(staging, { recursive: true });
    for (const file of files) {
      const text = edited.get(file);
      write(file, text ?? readFileSync(join(template, file)));
    }
    write(STAMP_FILE, `${JSON.stringify(stamp, null, 2)}\n`);
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  return { ok: true, target, dryRun: false, edits, stamp, next };
}

function changedLines(edit: Edit): string[] {
  const a = edit.before.split("\n");
  const b = edit.after.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`  - ${a[i]}`);
      if (b[i] !== undefined) out.push(`  + ${b[i]}`);
    }
  }
  return out;
}

function main(argv: string[]): number {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run") flags.set("dry-run", true);
    else if (arg.startsWith("--")) flags.set(arg.slice(2), argv[++i] ?? "");
    else positional.push(arg);
  }
  const str = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
  if (positional.length !== 1 || !flags.has("port") || !flags.has("design")) {
    console.error("usage: node examples/demo-kit/adopt.ts <name> --port N --design D [--title T] [--tagline T] [--dry-run]");
    return 2;
  }
  const result = adopt(
    { name: positional[0]!, port: Number(str("port")), design: str("design") ?? "", title: str("title"), tagline: str("tagline") },
    { dryRun: flags.has("dry-run") },
  );
  if (!result.ok) {
    console.error(`blocked: ${result.prerequisite} - ${result.error}\n  remedy: ${result.remedy}`);
    return 1;
  }
  for (const edit of result.edits) console.log([edit.file, ...changedLines(edit)].join("\n"));
  console.log(`${STAMP_FILE}: template ${result.stamp.digest.slice(0, 12)}`);
  console.log(result.dryRun ? "\n(dry run: nothing written)" : `\nadopted into ${relative(process.cwd(), result.target) || "."}`);
  if (!result.dryRun) console.log(["next:", ...result.next.map((s) => `  ${s}`)].join("\n"));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
