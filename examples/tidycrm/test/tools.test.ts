/**
 * The tool surface, checked against the actions it exists to reach and against the design 5.1 rule.
 *
 * Nothing in this repo asserted anything about the catalogue, and it drifted the worst way it
 * could: of the eight server actions in `app/actions.ts`, five were reachable from a tool and the
 * three that were not - `resolvePairAction`, `undoAction`, `previewNormalizeAction` - were all on
 * the safe side of the line. So the only verb that could close a merge-queue pair was
 * `merge_contacts`, the irreversible one, and `normalize_fields` advertised an undo the caller had
 * no way to perform. Two properties are pinned here:
 *
 *   1. every export of `app/actions.ts` is reachable from exactly one tool module;
 *   2. the class each tool lands in is the one the rule gives it, not the one this app would like.
 *
 * The second reads the classes back through the kit's own `annotationsFor`, so the check is the
 * rule a consumer runs (`examples/athena-sidepanel/gate.js`, `flagsOf` then `classify`) and not a
 * second copy of it: AUTO iff `reversible` and `side_effects !== "external"`. `undo` is GATED by
 * that rule, however benign it feels, because `undoActivity` writes its own activity row
 * `reversible: false` - an undo cannot be undone.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { annotationsFor } from "@athena/demo-kit/webmcp";

process.chdir(mkdtempSync(join(tmpdir(), "tidycrm-test-")));

const { listActivity, undoActivity } = await import("@athena/demo-kit/activity");
const { db, getPair, listOpenPairs } = await import("../lib/db");
const { applyUndo, resolvePair, planNormalize } = await import("../lib/mutations");

const from = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(from(path), "utf8");

const SHELL = "components/shell/HostCapabilities.tsx";
/** The other tool module. It registers reads of the sheet and imports no server action. */
const BLOCKS = "components/blocks/tools/BlocksTools.tsx";
const ACTIONS = "app/actions.ts";

interface Spec {
  name: string;
  reversible: boolean;
  sideEffects: "none" | "data" | "external";
}

/**
 * Every `useWebMCPTool({ ... })` in a source file, read for the three fields the gate uses.
 *
 * Source text rather than a render: the registrations are React hooks in a client component, and
 * what is being asserted is the declaration, which is exactly what the text carries. Each call is
 * taken as the span up to the next one, and the FIRST match of each field inside it is the tool's
 * own - a `parameters` entry also has a `name`, and a prose comment may quote a flag.
 */
function specs(file: string): Spec[] {
  const chunks = read(file).split("useWebMCPTool({").slice(1);
  return chunks.map((chunk, i) => {
    const name = /name: "([a-z_]+)"/.exec(chunk)?.[1];
    const reversible = /reversible: (true|false)/.exec(chunk)?.[1];
    const sideEffects = /sideEffects: "(none|data|external)"/.exec(chunk)?.[1];
    assert.ok(name && reversible && sideEffects, `${file}: registration #${i + 1} is missing a field`);
    return {
      name,
      reversible: reversible === "true",
      sideEffects: sideEffects as Spec["sideEffects"],
    } satisfies Spec;
  });
}

/**
 * Design 5.1, through the kit's annotations rather than a second copy of the rule.
 *
 * The four branches are `flagsOf` + `classify` from `examples/athena-sidepanel/gate.js`, in order.
 * The fourth is the one a consumer gets wrong by reading the rule as "anything not read-only is
 * gated": both hints present and both false is a DECLARED reversible app-data write, and it is
 * AUTO. It is also the commonest class on this surface.
 */
function classOf(spec: Spec): "AUTO" | "GATED" {
  const ann = annotationsFor(spec);
  if (ann.consequentialHint === true) return "GATED";
  if (ann.readOnlyHint === true) return "AUTO";
  if (ann.readOnlyHint === false && ann.consequentialHint === false) return "AUTO";
  return "GATED";
}

const shell = specs(SHELL);

test("every server action is reachable from exactly one tool module", () => {
  const exported = [...read(ACTIONS).matchAll(/export async function (\w+)/g)].map((m) => m[1]!);
  assert.equal(exported.length, 13, "the action surface changed; this test is counting it");

  const importedBy = (file: string): string[] => {
    const block = /import \{([^}]*)\} from "@\/app\/actions";/.exec(read(file));
    return block ? block[1]!.split(",").map((s) => s.trim()).filter(Boolean) : [];
  };
  const reached = [...importedBy(SHELL), ...importedBy(BLOCKS)];

  assert.deepEqual(
    exported.filter((a) => !reached.includes(a)),
    [],
    "exported by app/actions.ts and reachable from no tool",
  );
  assert.equal(new Set(reached).size, reached.length, "an action is wired into two tool modules");
});

test("the shell registers the whole surface, every preview and both non-merge verdicts", () => {
  assert.deepEqual(shell.map((s) => s.name), [
    "navigate",
    "export",
    "read_state",
    "normalize_fields",
    "preview_normalize",
    "flag_stale",
    "merge_contacts",
    "delete_contacts",
    // The read the three id-taking tools depend on. Before it, nothing here handed out a pair id
    // and the two GATED tools were unreachable from a conversation.
    "read_pairs",
    "preview_merge",
    "resolve_pair",
    // The company-name conflict: read it, preview the rewrite, write it. All three AUTO, because
    // the write is a revision row per contact and `undo` replays them backwards.
    "read_conflicts",
    "preview_company",
    "resolve_company",
    "undo",
  ]);
});

test("the class of every tool is the one the rule gives it", () => {
  const gated = shell.filter((s) => classOf(s) === "GATED").map((s) => s.name);
  // Not a restatement of the declarations: `undo` reads as harmless and is gated anyway, because
  // the rule is computed from `reversible`, and an undo is a write this app cannot put back.
  assert.deepEqual(gated, ["merge_contacts", "delete_contacts", "undo"]);

  for (const spec of shell) {
    assert.equal(
      classOf(spec),
      spec.reversible && spec.sideEffects !== "external" ? "AUTO" : "GATED",
      `${spec.name} does not land where design 5.1 puts it`,
    );
  }
});

test("a pair can be closed without destroying a record, and the closure is reversible", () => {
  const [pair] = listOpenPairs(1);
  assert.ok(pair);

  // `resolve_pair`'s handler, minus the toast: the reversible half of the queue's verdicts, which
  // had no tool at all while `merge_contacts` did.
  assert.equal(resolvePair(pair.id, "kept_both").ok, true);
  assert.equal(getPair(pair.id)?.status, "kept_both");

  const entry = listActivity(db(), 1)[0];
  assert.ok(entry && entry.action === "keep_both" && entry.reversible);

  // `undo`'s handler. The verdict comes back, which is the promise the description makes.
  assert.equal(undoActivity(db(), entry.id, applyUndo).ok, true);
  assert.equal(getPair(pair.id)?.status, "open", "the mis-keyed verdict cost one call");

  // And an undo is not itself undoable - which is why the tool is GATED.
  const undone = listActivity(db(), 1)[0];
  assert.ok(undone && undone.action === "undo");
  assert.equal(undone.reversible, false);
  assert.equal(undoActivity(db(), undone.id, applyUndo).ok, false);
});

test("preview_normalize changes nothing, which is what its `none` declares", () => {
  const [pair] = listOpenPairs(1);
  assert.ok(pair);
  const before = db().get<{ n: number }>("SELECT COUNT(*) AS n FROM revisions")?.n ?? 0;

  const plans = planNormalize([pair.keep_id, pair.drop_id], ["trim_whitespace", "phone_e164"]);
  for (const plan of plans) assert.ok(plan.changes.length > 0, "a plan with no work is not returned");

  assert.equal(db().get<{ n: number }>("SELECT COUNT(*) AS n FROM revisions")?.n ?? 0, before);
});
