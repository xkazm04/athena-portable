/**
 * The channel events, held to the contract they mirror — `src/athena/contracts/channel.py`, README
 * section 3.2 ("eleven events, one stream").
 *
 * `events.ts` is a hand-written mirror of the Python dataclasses, and a field added on one side
 * only is invisible to both compilers: the daemon serialises it, the panel's type does not know
 * it, and every test on either side stays green. This reads the contract file itself and holds
 * the kinds, the families, each event's field names and which of them may be null.
 * (`tests/contracts/test_channel.py` holds the transcript outcomes and `VoiceTranscript`; this
 * covers the other ten events and the families.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { FAMILIES } from "./events";

const CHANNEL_PY = resolve(__dirname, "../../../../src/athena/contracts/channel.py");
const EVENTS_TS = resolve(__dirname, "events.ts");

interface Shape {
  /** Field name to "may be null". `kind` is not a field on either side; it is checked as the key. */
  fields: Map<string, boolean>;
}

/** Every `@dataclass` class body in channel.py, by class name, docstrings and comments removed. */
function pythonClasses(): Map<string, string> {
  const text = readFileSync(CHANNEL_PY, "utf8")
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/#[^\n]*/g, "");
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^class (\w+)(?:\([^)]*\))?:\n((?:(?: {4}[^\n]*)?\n)*)/gm)) out.set(m[1], m[2]);
  return out;
}

/** The Python events, by `kind`, with their fields. */
function pythonEvents(): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const body of pythonClasses().values()) {
    const kind = /^ {4}kind: ClassVar\[str\] = "([^"]+)"/m.exec(body)?.[1];
    if (!kind || kind === "event") continue;
    out.set(kind, { fields: pythonFields(body) });
  }
  return out;
}

function pythonFields(body: string): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  for (const m of body.matchAll(/^ {4}(\w+): ([^=\n]+?)\s*(?:=[^\n]*)?$/gm)) {
    if (m[2].startsWith("ClassVar")) continue;
    fields.set(m[1], /\|\s*None\b|Optional\[/.test(m[2]));
  }
  return fields;
}

/** Python's `FAMILIES` literal. */
function pythonFamilies(): Record<string, string[]> {
  const text = readFileSync(CHANNEL_PY, "utf8");
  const block = /^FAMILIES[^=]*=\s*\{([\s\S]*?)^\}/m.exec(text)?.[1] ?? "";
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/"(\w+)":\s*\(([^)]*)\)/g)) {
    out[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
  }
  return out;
}

/** Every `export interface` in events.ts, by name, comments removed. */
function tsInterfaces(): Map<string, string> {
  const text = readFileSync(EVENTS_TS, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const out = new Map<string, string>();
  for (const m of text.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) out.set(m[1], m[2]);
  return out;
}

function tsFields(body: string): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  for (const m of body.matchAll(/^\s*(\w+)(\?)?:\s*([^;]+);/gm)) {
    if (m[1] === "kind") continue;
    fields.set(m[1], /\bnull\b/.test(m[3]));
  }
  return fields;
}

/** The TS events, by the `kind` literal each interface declares. */
function tsEvents(): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const body of tsInterfaces().values()) {
    const kind = /^\s*kind:\s*"([^"]+)";/m.exec(body)?.[1];
    if (kind) out.set(kind, { fields: tsFields(body) });
  }
  return out;
}

/** The members of the `EventKind` union. */
function tsKinds(): string[] {
  const text = readFileSync(EVENTS_TS, "utf8");
  const union = /export type EventKind\s*=([^;]*);/.exec(text)?.[1] ?? "";
  return [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

test("both reads found the eleven events, so an empty answer cannot pass for agreement", () => {
  expect(pythonEvents().size).toBe(11);
  expect(tsEvents().size).toBe(11);
});

test("the EventKind union and the event interfaces name exactly the contract's kinds", () => {
  const kinds = sorted(pythonEvents().keys());
  expect(sorted(tsKinds())).toEqual(kinds);
  expect(sorted(tsEvents().keys())).toEqual(kinds);
});

test("the families are the contract's, family for family and in order", () => {
  expect(Object.keys(pythonFamilies()).length).toBeGreaterThan(0);
  expect(Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, [...v]]))).toEqual(pythonFamilies());
});

test("each event names every field the contract does, and nothing else", () => {
  const ts = tsEvents();
  for (const [kind, shape] of pythonEvents()) {
    expect(sorted(ts.get(kind)?.fields.keys() ?? []), kind).toEqual(sorted(shape.fields.keys()));
  }
});

test("a field the contract allows to be None is the one the mirror allows to be null", () => {
  const ts = tsEvents();
  for (const [kind, shape] of pythonEvents()) {
    const mirror = ts.get(kind)?.fields ?? new Map<string, boolean>();
    for (const [field, nullable] of shape.fields) {
      expect(mirror.get(field), `${kind}.${field}`).toBe(nullable);
    }
  }
});

test("a decision option is an id and a label on both sides", () => {
  const py = pythonFields(pythonClasses().get("DecisionOption") ?? "");
  const ts = tsFields(tsInterfaces().get("DecisionOption") ?? "");
  expect(sorted(ts.keys())).toEqual(sorted(py.keys()));
  expect(py.size).toBe(2);
});
