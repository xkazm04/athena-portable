/**
 * The Python tree's imports, read as text — and the model's edges held to them.
 *
 * NO PYTHON RUNS. `importsOf` pattern-scrapes a module's source for the modules it imports (a
 * top-level `import`, a `from ... import`, a parenthesised multi-line list, and an import inside a
 * function body all count; a comment or a docstring that merely shows an import does not), so the
 * test that uses it needs nothing but the file on disk. It is a scraper, not a parser: a relative
 * import is ignored (no modelled module uses one), and `from X import a` yields both `X` and `X.a`
 * because the text cannot say whether `a` is a name or a submodule — either way the file reaches X.
 *
 * `checkEdges` is the rule `data/types.ts` states for `Edge.via`, kept pure (`read` is injected) so
 * a seeded edge can be shown to fail without touching the tree.
 */
import type { Component, Edge } from "../data";

/** Docstrings and other triple-quoted strings: an import shown in prose is not an import. */
const TRIPLE = /("""[\s\S]*?"""|'''[\s\S]*?''')/g;
const COMMENT = /#.*$/gm;
/** `from X import a, b as c` or `from X import (\n a,\n b,\n)`, at any indent. */
const FROM = /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm;
/** `import X`, `import X.Y as Z, W`, at any indent. */
const IMPORT = /^[ \t]*import[ \t]+([^\n]+)/gm;

const names = (list: string): string[] =>
  list
    .replace(/[()\\]/g, " ")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim() ?? "")
    .filter((n) => /^[A-Za-z_]\w*$/.test(n));

/** Every dotted module a Python source imports, top-level or local, comments and docstrings aside. */
export function importsOf(text: string): Set<string> {
  const code = text.replace(TRIPLE, "").replace(COMMENT, "");
  const out = new Set<string>();
  for (const m of code.matchAll(FROM)) {
    const base = m[1] ?? "";
    if (base.startsWith(".")) continue;
    out.add(base);
    for (const n of names(m[2] ?? "")) out.add(`${base}.${n}`);
  }
  for (const m of code.matchAll(IMPORT)) {
    for (const part of (m[1] ?? "").split(",")) {
      const dotted = part.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
      if (/^[A-Za-z_][\w.]*$/.test(dotted)) out.add(dotted);
    }
  }
  return out;
}

/** `src/athena/core/catalog.py` -> `athena.core.catalog`; a package's `__init__` is the package. */
export function moduleOf(path: string): string {
  return path
    .replace(/^src\//, "")
    .replace(/\.py$/, "")
    .replace(/\/__init__$/, "")
    .split("/")
    .join(".");
}

/** A path the scraper can read: a Python module under `src/athena`. */
export const isPython = (path: string): boolean =>
  path.startsWith("src/athena/") && path.endsWith(".py");

/** Where a port is bound: the composition root imports the concrete class it hands in. */
export const COMPOSITION_ROOT = "src/athena/wiring.py";

export interface EdgeVerdict {
  edge: Edge;
  state: "checked" | "skipped";
  /** Set only on a checked edge whose claim the tree does not hold. */
  failure?: string;
  /** Set on a skipped edge: why the tree was not asked. */
  reason?: string;
}

const label = (e: Edge): string => `${e.from}->${e.to}`;

/**
 * Every edge, asked of the tree where the tree can answer and skipped with a reason where it
 * cannot. `read` returns a file's text, or `null` when it is not there.
 *
 *   import  both ends Python: the from-file imports the to-file's module — or, with `through`, the
 *           from-file imports `through` and `through` imports the to-file (one named hop: a base
 *           class, a re-export, the daemon object that holds the service)
 *   port    `through` names the port module; the from-file imports it (or IS it, when the port is
 *           declared beside its consumer), and the composition root imports the to-file's module.
 *           When the edge points AT the port (`through` is the to-file: a structural implementer),
 *           the composition root imports the from-file's module instead — it binds the implementer
 *   wire    a protocol hop (HTTP, SSE, WebSocket, IPC): skipped, the reason names the protocol
 *
 * An edge with a non-Python end (Rust, JS, TS, Markdown, a directory) is skipped with that reason.
 */
export function checkEdges(
  edges: readonly Edge[],
  components: readonly Component[],
  read: (path: string) => string | null,
): EdgeVerdict[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const cache = new Map<string, Set<string> | null>();
  const importsAt = (path: string): Set<string> | null => {
    if (!cache.has(path)) {
      const text = read(path);
      cache.set(path, text === null ? null : importsOf(text));
    }
    return cache.get(path) ?? null;
  };

  return edges.map((edge): EdgeVerdict => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return { edge, state: "checked", failure: `${label(edge)}: an end is not a component` };

    if (edge.via === "wire") {
      const protocol = edge.protocol?.trim() ?? "";
      if (protocol === "") return { edge, state: "checked", failure: `${label(edge)}: a wire edge names no protocol` };
      return { edge, state: "skipped", reason: `a ${protocol} hop, not an import` };
    }
    const foreign = [from, to].find((c) => !isPython(c.file));
    if (foreign) return { edge, state: "skipped", reason: `${foreign.file} is not a Python module` };
    if (from.status === "planned" || to.status === "planned") {
      const planned = from.status === "planned" ? from : to;
      return { edge, state: "skipped", reason: `${planned.file} is planned, not in the tree` };
    }

    const fromImports = importsAt(from.file);
    if (fromImports === null) return { edge, state: "checked", failure: `${label(edge)}: ${from.file} is not in the tree` };
    const target = moduleOf(to.file);

    if (edge.via === "import") {
      const through = edge.through?.trim() ?? "";
      if (through !== "") {
        const hop = importsAt(through);
        if (!fromImports.has(moduleOf(through))) {
          return { edge, state: "checked", failure: `${label(edge)}: ${from.file} never imports ${moduleOf(through)}` };
        }
        if (!hop?.has(target)) {
          return { edge, state: "checked", failure: `${label(edge)}: ${through} never imports ${target}` };
        }
        return { edge, state: "checked" };
      }
      if (fromImports.has(target)) return { edge, state: "checked" };
      return { edge, state: "checked", failure: `${label(edge)}: ${from.file} never imports ${target}` };
    }
    if (edge.via === "port") {
      const through = edge.through?.trim() ?? "";
      if (through === "") return { edge, state: "checked", failure: `${label(edge)}: a port edge names no \`through\`` };
      if (read(through) === null) return { edge, state: "checked", failure: `${label(edge)}: through ${through} is not in the tree` };
      const implementer = through === to.file;
      if (!implementer && through !== from.file && !fromImports.has(moduleOf(through))) {
        return { edge, state: "checked", failure: `${label(edge)}: ${from.file} never imports its port ${through}` };
      }
      const bound = implementer ? moduleOf(from.file) : target;
      const root = importsAt(COMPOSITION_ROOT);
      if (!root?.has(bound)) {
        return { edge, state: "checked", failure: `${label(edge)}: ${COMPOSITION_ROOT} never binds ${bound}` };
      }
      return { edge, state: "checked" };
    }
    return { edge, state: "checked", failure: `${label(edge)}: no \`via\`` };
  });
}
