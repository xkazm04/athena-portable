/**
 * The blocks UI: what the camera, the dossier and the sheet chrome promise, held to the code.
 *
 * The components are JSX and this runner strips types without compiling JSX, so two kinds of check
 * live here: the pure arithmetic the components call (imported and run), and the words a component
 * prints or announces (read from the source with comments stripped first, so a comment that talks
 * about a rule cannot satisfy it).
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("tidycrm-test-");

const { wheelPose } = await import("../components/blocks/space/useWheelZoom");
const { BOUNDS, REST } = await import("../components/blocks/space/camera");
const { clampPose } = await import("@athena/demo-kit/zoom");
const { db, getContact, listOpenPairs } = await import("../lib/db");
const { flagStale, mergeContacts, resolvePair } = await import("../lib/mutations");
const { buildSheet } = await import("../lib/blocks");

const from = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** Source text with block and line comments removed, so prose cannot pass for code. */
function code(path: string): string {
  return readFileSync(from(path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** The prose a component prints, with JSX expressions and markup flattened to spaces. */
function words(path: string): string {
  return code(path)
    .replace(/&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ the wheel */

const BOX = { left: 0, top: 0, width: 1200, height: 800 };
/** A notch at a corner, so the anchor pulls the pan hard if the step solves it. */
const notch = (deltaY: number) => ({ deltaY, deltaMode: 0, clientX: 1100, clientY: 700 });

/** One notch as the rig lands it: `rig.set` clamps the pose it is handed to the bounds. */
const step = (pose: typeof REST, deltaY: number) =>
  clampPose(wheelPose(pose, notch(deltaY), BOX, BOUNDS.zoom), BOUNDS);

test("ten wheel notches past either zoom bound leave the pose where it stood", () => {
  for (const [label, zoom, deltaY] of [
    ["in, at the maximum", BOUNDS.zoom[1], -120],
    ["out, at the minimum", BOUNDS.zoom[0], 120],
  ] as const) {
    const start = { ...REST, zoom };
    let pose = start;
    for (let i = 0; i < 10; i += 1) pose = step(pose, deltaY);
    assert.equal(pose.zoom, zoom, `${label}: the zoom stays at its bound`);
    assert.deepEqual(pose.pan, start.pan, `${label}: the pan does not slide toward the pointer`);
  }
});

test("inside the bounds the wheel still zooms at the pointer", () => {
  const pose = step(REST, -120);
  assert.ok(pose.zoom > REST.zoom, "a notch in zooms in");
  assert.notDeepEqual(pose.pan, REST.pan, "and keeps the point under the pointer, which moves the pan");
});

/* ------------------------------------------------------- the merge's consent */

/** The merge confirmation the gate prints, and the description an agent reads before the same act. */
const gateMergeQuestion = () => {
  const gate = words("components/blocks/dossier/Gate.tsx");
  return gate.slice(gate.indexOf('armed === "merge"'), gate.indexOf('armed === "delete"'));
};
const toolMergeDescription = () => {
  const shell = words("components/shell/HostCapabilities.tsx");
  const at = shell.indexOf('name: "merge_contacts"');
  return shell.slice(at, shell.indexOf("parameters:", at));
};

test("a merge carries the folded record's valid phone and newer activity date over the survivor's", () => {
  const pairs = listOpenPairs(200);
  const phone = pairs.find((p) => {
    const keep = getContact(p.keep_id)!;
    const drop = getContact(p.drop_id)!;
    return keep.phone_ok === 0 && drop.phone_ok === 1 && keep.phone !== drop.phone;
  });
  const newer = pairs.find((p) => {
    if (p.id === phone?.id) return false;
    return getContact(p.drop_id)!.last_activity_at > getContact(p.keep_id)!.last_activity_at;
  });
  assert.ok(phone && newer, "the seed holds a pair of each kind");

  const dropPhone = getContact(phone.drop_id)!.phone;
  assert.equal(mergeContacts(phone.keep_id, phone.drop_id).ok, true);
  assert.equal(getContact(phone.keep_id)!.phone, dropPhone, "the survivor took the folded record's phone");

  const dropSeen = getContact(newer.drop_id)!.last_activity_at;
  assert.equal(mergeContacts(newer.keep_id, newer.drop_id).ok, true);
  assert.equal(getContact(newer.keep_id)!.last_activity_at, dropSeen, "and its newer activity date");
});

test("the merge's consent says so, at the gate and in the tool an agent reads", () => {
  for (const [where, text] of [
    ["the gate's confirmation", gateMergeQuestion()],
    ["merge_contacts' description", toolMergeDescription()],
  ] as const) {
    assert.ok(text.length > 40, `${where} was found in the source`);
    assert.doesNotMatch(
      text,
      /disagree on take the surviving record's value/,
      `${where} promises the survivor's value for every field the two disagree on`,
    );
    assert.match(text, /phone/i, `${where} names the phone the merge can carry over`);
    assert.match(text, /activity/i, `${where} names the activity date the merge can carry over`);
  }
});

/* ------------------------------------------------------------- the auto bar */

test("the auto bar's note claims nothing two of its four acts do not do", () => {
  const revisions = () => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM revisions")!.n;
  const table = buildSheet()
    .databases.flatMap((d) => d.tables)
    .find((t) => t.staleIds.length > 0 && t.pairs.length > 0);
  assert.ok(table, "the seed holds a table with stale rows and an open pair");

  // Flag stale and keep both are AUTO because undo can put them back, not because they write a
  // revision row: neither does.
  const before = revisions();
  assert.equal(flagStale(table.staleIds).ok, true);
  assert.equal(resolvePair(table.pairs[0]!.id, "kept_both").ok, true);
  assert.equal(revisions(), before, "flag stale and keep both write no revision row");

  const gate = words("components/blocks/dossier/Gate.tsx");
  const note = /label="Auto" note="([^"]*)"/.exec(gate)?.[1];
  assert.ok(note !== undefined, "the auto band's note was found");
  assert.doesNotMatch(note, /revisions/, "the note says every change lands in the revisions table");
  assert.doesNotMatch(note, /`/, "the note prints Markdown backticks as literal characters");
});

/* ------------------------------------------------------------ the vocabulary */

/** This context's components; the level words they print are `BK_LEVELS`' (model/vocabulary.ts). */
const COMPONENTS = [
  "components/blocks/Blocks.tsx",
  "components/blocks/Cluster.tsx",
  "components/blocks/Dossier.tsx",
  "components/blocks/Field.tsx",
  "components/blocks/Stat.tsx",
  "components/blocks/World.tsx",
  "components/blocks/dossier/Checks.tsx",
  "components/blocks/dossier/Gate.tsx",
  "components/blocks/dossier/Head.tsx",
  "components/blocks/dossier/Pair.tsx",
  "components/blocks/dossier/parts.tsx",
  "components/blocks/field/Head.tsx",
  "components/blocks/l0/Keys.tsx",
  "components/blocks/l0/L0.tsx",
  "components/blocks/sheet/Foot.tsx",
  "components/blocks/sheet/Head.tsx",
];

test("the table a dossier opens is called a table and its parent a database, as BK_LEVELS has it", async () => {
  const { BK_LEVELS } = await import("../components/blocks/model");
  assert.deepEqual([...BK_LEVELS].slice(1), ["One database", "One table"]);
  for (const file of COMPONENTS) {
    // Class names keep their history (`bk-zone-strip`); what is checked is what a reader is told.
    const told = words(file).replace(/className="[^"]*"/g, "").replace(/\bbk-[\w-]+/g, "");
    assert.doesNotMatch(told, /\bzones?\b/i, `${file} still calls a database a zone`);
  }
  assert.doesNotMatch(
    words("components/blocks/dossier/Head.tsx"),
    /aria-label="[^"]*\bblock\b/,
    "the dossier's close button calls the table a block",
  );
  assert.doesNotMatch(
    words("components/blocks/dossier/Checks.tsx"),
    /label="[^"]*\bblock\b/,
    "the checks band calls the table a block",
  );
});

/* ------------------------------------------------------------- the caption */

test("the L0 caption counts one of anything in the singular", async () => {
  const { databaseSummary } = await import("../components/blocks/l0/cells");
  const one = {
    id: "billing",
    name: "Billing",
    blurb: "",
    tables: 1,
    records: 1,
    outstanding: 1,
    faulty: 1,
    attention: 0,
    clear: 0,
    dots: [],
    share: 1,
  };
  const said = databaseSummary(one);
  assert.doesNotMatch(said, /\b1 (records|deviations|tables)\b/, `plural after one: ${said}`);
  assert.match(said, /1 record\b/);
  assert.match(said, /1 deviation outstanding/);
  assert.match(databaseSummary({ ...one, records: 2, outstanding: 2 }), /2 records, .*2 deviations outstanding/);
});

/* ------------------------------------------------------- the tools' contract */

/** One tool's description, from the shell's registration. */
const toolDescription = (name: string): string => {
  const shell = words("components/shell/HostCapabilities.tsx");
  const at = shell.indexOf(`name: "${name}"`);
  assert.ok(at >= 0, `${name} is registered`);
  return shell.slice(at, shell.indexOf("parameters:", at));
};

test("undo's description names every refusal applyUndo can give, so an agent can plan the order", () => {
  // lib/mutations.ts throws UndoRefused for these two (pinned in test/domain-lib.test.ts); the
  // kit's undoActivity refuses the other two.
  const refusals = [...readFileSync(from("lib/mutations.ts"), "utf8").matchAll(/throw new UndoRefused\(/g)];
  assert.equal(refusals.length, 2, "applyUndo still refuses in exactly two places");
  const said = toolDescription("undo");
  assert.match(said, /not reversible/, "an irreversible entry");
  assert.match(said, /already undone/, "an entry undone before");
  assert.match(said, /changed again|later write|later change/, "a field a later write has changed since");
  assert.match(said, /no longer in the list|left the list|deleted or merged/, "a pair whose record is gone");
});

test("the export tool names the file the way the route does, through lib/csv.ts", () => {
  const shell = code("components/shell/HostCapabilities.tsx");
  assert.match(shell, /import \{[^}]*\bexportFilename\b[^}]*\} from "@\/lib\/csv"/, "it reads the one rule");
  assert.doesNotMatch(shell, /tidycrm-\$\{/, "and types no second copy of it");
});

test("the foot's deviation breakdown walks DEVIATION_KINDS, not a copy of it", () => {
  const foot = code("components/blocks/sheet/Foot.tsx");
  assert.doesNotMatch(foot, /\[\s*"duplicate",\s*"conflict"/, "Foot types its own list of the four kinds");
  assert.match(foot, /DEVIATION_KINDS\.map\(/, "the breakdown is drawn from the model's list");
});

test("a table's card is announced name first, the order it prints in", () => {
  const field = code("components/blocks/Field.tsx");
  const label = [...field.matchAll(/aria-label=\{`([^`]*)`\}/g)]
    .map((m) => m[1]!)
    .find((l) => l.includes("${table.ident}"));
  assert.ok(label, "the card's accessible name was found");
  assert.match(label, /^Open \$\{table\.name\}/, `the name leads, as on the card: ${label}`);
  assert.match(label, /\$\{table\.ident\}/, "and the ident is still in it");
});
