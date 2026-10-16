/**
 * The lanes UI's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * The components under `components/lanes/` hold JSX, which this runner cannot load, so what is
 * pinned here is the part of each rule that lives in a plain module beside them (`useRun.ts`,
 * `card/read.ts`, `swarm/marks.ts`) - driven against a scratch copy of the seeded books where the
 * rule is about the books - plus, where the rule is only that a component USES that part, a
 * source check with the comments stripped first. Each test was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-lanes-ui-");

/* ------------------------------------------------------------------- the stand-ins */

/** What one `run` reached: the toast (with its tone), the router's refresh, the `after` callback. */
let reached: string[] = [];
/** The transition body `run` handed to `startTransition`, so a test can await it. */
let started: Promise<unknown> | null = null;

const RECORDER = Symbol.for("ledgerbox.lanes-ui.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  start(fn: () => Promise<unknown>) {
    started = fn();
  },
  router: { refresh: () => reached.push("router.refresh") },
  toaster: { toast: (_text: string, tone: string) => reached.push(`toast:${tone}`) },
};
const recorder = `globalThis[Symbol.for("ledgerbox.lanes-ui.recorder")]`;
const moduleOf = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

(globalThis as Record<symbol, unknown>)[Symbol.for("ledgerbox.test.standIns")] = {
  scope: new URL("../components/lanes/useRun.ts", import.meta.url).href,
  modules: {
    react: moduleOf(
      [
        `export const useCallback = (fn) => fn;`,
        `export const useTransition = () => [false, (fn) => ${recorder}.start(fn)];`,
      ].join("\n"),
    ),
    "next/navigation": moduleOf(`export const useRouter = () => ${recorder}.router;`),
    "@athena/demo-kit/ui": moduleOf(`export const useToast = () => ${recorder}.toaster;`),
  },
};

// Renamed: it is called here as a plain function over stand-ins, not as a hook inside a render.
const { ACT_THREW, useRun: cardRun } = await import("../components/lanes/useRun");

/** A source file under `components/lanes/`, comments stripped, so prose about a rule cannot pass for it. */
const source = (path: string) =>
  readFileSync(new URL(`../components/lanes/${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Run one act through the card's `run`, the way a button does, and wait for its transition. */
async function press(act: () => Promise<{ ok: boolean; message: string }>): Promise<string[]> {
  reached = [];
  started = null;
  const { run } = cardRun();
  run(act, () => reached.push("after"));
  await started;
  return reached;
}

/* ------------------------------------------------------------------------ the tests */

test("an act that throws under a person's click still tells them, re-reads the sheet and closes the gate", async () => {
  // The tool path (`tools/BooksTools.tsx` settle) learned this in cb124b4; the card's own path is
  // the other implementation of the same rule. A server action that throws - a locked database, a
  // dropped connection - used to reject out of the transition with no toast, no refresh, and the
  // gate still armed over an outcome nobody knows.
  const original = console.error;
  console.error = () => {};
  try {
    const seen = await press(() => Promise.reject(new Error("database is locked")));
    assert.deepEqual(seen, ["toast:error", "router.refresh", "after"], `the person saw: ${seen.join(", ") || "nothing"}`);
  } finally {
    console.error = original;
  }
  // One sentence for one event, whichever path the act came down.
  assert.ok(source("tools/BooksTools.tsx").includes(JSON.stringify(ACT_THREW)), "the tool path says the same words");
});

test("an act that answers is toasted in its own tone, and leaves the refresh to its own revalidatePath", async () => {
  assert.deepEqual(await press(async () => ({ ok: true, message: "Done." })), ["toast:success", "after"]);
  assert.deepEqual(await press(async () => ({ ok: false, message: "Refused." })), ["toast:error", "after"]);
});
