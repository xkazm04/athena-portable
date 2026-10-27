/**
 * The Rust shapes `lib/ipc.ts` and `lib/daemon.ts` restate, held to the Rust — README section 3.5.
 *
 * `STORE_TABLES` says "this list is the same list" as `store.rs`; `DaemonStatus` and `Tab` say
 * "field for field". Each was a promise in a comment. This reads the Rust and keeps it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { STORE_TABLES } from "./ipc";

const SRC = resolve(__dirname, "../../src-tauri/src");
const LIB = resolve(__dirname);

const rust = (file: string) => readFileSync(resolve(SRC, file), "utf8").replace(/\/\/[^\n]*/g, "");
const ts = (file: string) =>
  readFileSync(resolve(LIB, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** The field names of `pub struct <name> { ... }`. */
function rustFields(file: string, name: string): string[] {
  const body = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(rust(file))?.[1] ?? "";
  return [...body.matchAll(/^\s*pub (\w+):/gm)].map((m) => m[1]).sort();
}

/** The field names of `export interface <name> { ... }`. */
function tsFields(file: string, name: string): string[] {
  const body = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(ts(file))?.[1] ?? "";
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
}

test("STORE_TABLES is store.rs's TABLES, name for name and in order", () => {
  const block = /const TABLES: &\[Table\] = &\[([\s\S]*?)\n\];/.exec(rust("store.rs"))?.[1] ?? "";
  const names = [...block.matchAll(/^ {8}name: "([a-z_]+)",/gm)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(0);
  expect([...STORE_TABLES]).toEqual(names);
});

test("DaemonStatus names daemon.rs's fields, and DaemonHealth its Health variants", () => {
  const fields = rustFields("daemon.rs", "DaemonStatus");
  expect(fields.length).toBeGreaterThan(0);
  expect(tsFields("daemon.ts", "DaemonStatus")).toEqual(fields);

  const variants = /pub enum Health\s*\{([\s\S]*?)\n\}/.exec(rust("daemon.rs"))?.[1] ?? "";
  const snake = [...variants.matchAll(/^\s*([A-Z]\w*),/gm)].map((m) => m[1].replace(/(?<!^)[A-Z]/g, (c) => `_${c}`).toLowerCase());
  const union = /export type DaemonHealth\s*=([^;]*);/.exec(ts("daemon.ts"))?.[1] ?? "";
  expect(snake.length).toBeGreaterThan(0);
  expect([...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(snake.sort());
});

/** `pub struct <name>`'s fields as the wire spells them (serde renames applied), with their types. */
function rustWireFields(file: string, name: string): Array<[string, string]> {
  const body = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(rust(file))?.[1] ?? "";
  const out: Array<[string, string]> = [];
  for (const m of body.matchAll(/((?:\s*#\[[^\n]*\]\s*)*)\s*pub (\w+): ([^,\n]+),/g)) {
    const rename = /rename = "(\w+)"/.exec(m[1])?.[1];
    out.push([rename ?? m[2], m[3].trim()]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

test("face.rs's RawMotion and Motion are the TS FaceMotion, and every channel may be absent", () => {
  // A channel a motion track omits is "no say" (her own motion keeps it), not 0, on every hop:
  // the TS pose spells it null, so Rust must take and give back null for each one.
  const body = /export interface FaceMotion\s*\{([\s\S]*?)\n\}/.exec(
    readFileSync(resolve(LIB, "../avatar/types.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""),
  )?.[1];
  const tsMotion = [...(body ?? "").matchAll(/^\s*(\w+): ([^;]+);/gm)].map((m) => [m[1], m[2].trim()]).sort(([a], [b]) => a.localeCompare(b));
  expect(tsMotion.length).toBe(6);
  for (const [, type] of tsMotion) expect(type).toBe("number | null");
  for (const struct of ["RawMotion", "Motion"]) {
    const fields = rustWireFields("face.rs", struct);
    expect(fields.map(([n]) => n)).toEqual(tsMotion.map(([n]) => n));
    for (const [, type] of fields) expect(type).toBe("Option<f64>");
  }
});

test("Tab names tabs.rs's fields", () => {
  const fields = rustFields("tabs.rs", "Tab");
  expect(fields.length).toBeGreaterThan(0);
  expect(tsFields("ipc.ts", "Tab")).toEqual(fields);
});
