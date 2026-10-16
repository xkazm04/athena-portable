/**
 * The shell's command names, held to one another — README section 3.5 (the IPC boundary), the
 * `build.rs` header ("a new command has to be added in three places").
 *
 * A command lives in four hand-kept lists, and every compiler involved checks each one alone:
 *
 *  - D, declared: the app manifest in `src-tauri/build.rs`. A name missing here is
 *    `Permission ... not found` at runtime.
 *  - R, registered: `generate_handler!` in `src-tauri/src/lib.rs`. A name missing here is an
 *    unknown command at runtime.
 *  - P, permitted: the `allow-*` grants in `src-tauri/capabilities/*.json`, one set per surface. A
 *    grant for a name nobody declared fails the Tauri build; a name nobody grants is refused.
 *  - I, invoked: what the panel's code asks for through `lib/ipc.ts`'s `call`, plus the one call the
 *    page script in `bridge.rs` makes.
 *
 * Each set is read from the file that owns it, never from a copy, and each read asserts it found
 * something: an empty set is a broken scan, not a clean boundary.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

const APP = resolve(__dirname, "../..");
const TAURI = join(APP, "src-tauri");

/** Rust with its line comments gone, so a name in a comment is never read as a name in a list. */
function rust(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\/[^\n]*/g, "");
}

/** D: the strings inside `AppManifest::new().commands(&[ ... ])`. */
function declared(): Set<string> {
  const block = /\.commands\(&\[([\s\S]*?)\]\)/.exec(rust(join(TAURI, "build.rs")));
  expect(block, "build.rs declares no app manifest commands").not.toBeNull();
  return new Set([...(block?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

/** R: the paths inside `generate_handler![ ... ]`, by their last segment. */
function registered(): Set<string> {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(rust(join(TAURI, "src", "lib.rs")));
  expect(block, "lib.rs registers no handlers").not.toBeNull();
  return new Set(
    (block?.[1] ?? "")
      .split(",")
      .map((path) => path.trim().split("::").pop() ?? "")
      .filter((name) => name !== ""),
  );
}

/** P: each capability file's `allow-<command>` grants, as command names. `core:*` is Tauri's. */
function permitted(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const dir = join(TAURI, "capabilities");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const cap = JSON.parse(readFileSync(join(dir, file), "utf8")) as { permissions: unknown[] };
    const names = cap.permissions
      .filter((p): p is string => typeof p === "string" && p.startsWith("allow-"))
      .map((p) => p.slice("allow-".length).replace(/-/g, "_"));
    out.set(file, new Set(names));
  }
  return out;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * I: every `call("name", ...)` and `call(NAME, ...)` in the panel's source, with `NAME` resolved
 * through its `export const NAME = "..."`, plus the page script's `invoke("name", ...)`.
 */
function invoked(): Set<string> {
  const texts = sources(join(APP, "src")).map((path) => readFileSync(path, "utf8"));
  const constants = new Map<string, string>();
  for (const text of texts) {
    for (const m of text.matchAll(/export const ([A-Z_]+)\s*=\s*"([a-z_]+)"/g)) constants.set(m[1], m[2]);
  }
  const names = new Set<string>();
  for (const text of texts) {
    // The generic may nest (`call<StorePage<Row>>`) but never holds a parenthesis or a quote.
    for (const m of text.matchAll(/\bcall\s*(?:<[^("]*?>)?\s*\(\s*(?:"([a-z_]+)"|([A-Z_]+)\b)/g)) {
      const name = m[1] ?? constants.get(m[2]);
      if (name) names.add(name);
    }
  }
  for (const m of rust(join(TAURI, "src", "bridge.rs")).matchAll(/invoke\("([a-z_]+)"/g)) names.add(m[1]);
  return names;
}

/**
 * Registered and granted, and called by nothing in this tree (R - I). Each entry is a loan with a
 * reason: when a caller appears the entry must go, and the test below says so.
 */
const UNINVOKED: Readonly<Record<string, string>> = {
  athena_snap_to: "docking by name (265a41d); no surface asks for it yet, a drop docks through Rust",
};

const sorted = (set: Iterable<string>) => [...set].sort();

test("each list is read from its own file and none of the reads came back empty", () => {
  expect(declared().size).toBeGreaterThan(20);
  expect(registered().size).toBeGreaterThan(20);
  expect(invoked().size).toBeGreaterThan(20);
  expect(permitted().get("ui.json")?.size ?? 0).toBeGreaterThan(20);
});

test("every command build.rs declares is registered in lib.rs, and nothing else is", () => {
  expect(sorted(registered())).toEqual(sorted(declared()));
});

test("every grant in every capability names a registered command", () => {
  const known = registered();
  for (const [file, names] of permitted()) {
    expect(sorted([...names].filter((n) => !known.has(n))), file).toEqual([]);
  }
});

test("every command the panel or the page script calls is registered and granted somewhere", () => {
  const known = registered();
  const granted = new Set([...permitted().values()].flatMap((names) => [...names]));
  const calls = invoked();
  expect(sorted([...calls].filter((n) => !known.has(n))), "invoked, not registered").toEqual([]);
  expect(sorted([...calls].filter((n) => !granted.has(n))), "invoked, granted nowhere").toEqual([]);
});

test("a registered command nothing calls is a named loan, and a loan that found a caller is gone", () => {
  const calls = invoked();
  const idle = sorted([...registered()].filter((n) => !calls.has(n)));
  expect(idle).toEqual(sorted(Object.keys(UNINVOKED)));
});

test("the page webviews are granted bridge_reply and nothing else", () => {
  expect(sorted(permitted().get("page.json") ?? [])).toEqual(["bridge_reply"]);
});
