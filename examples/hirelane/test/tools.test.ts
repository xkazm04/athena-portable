/**
 * The capability register, as a browser agent will actually read it.
 *
 * Two claims this app makes on its own surface, decided here rather than believed:
 *
 *   1. **The class of every tool is what the manifest's rule says it is.** The foot prints two
 *      bands and the masthead says every capability below is registered and waiting; a tool whose
 *      `readOnlyHint` / `consequentialHint` pair disagrees with the band it is printed in would
 *      make the honesty line a decoration. `annotationsFor` is the kit's own function — the same
 *      one `useWebMCPTool` calls — so this asserts the bytes that reach `document.modelContext`.
 *   2. **"Rank them by university" is impossible, not refused.** There is no protected attribute
 *      in the schema and no parameter that could carry one, so there is nothing for a policy to
 *      switch off. Both halves are checked: the `applicants` table and every registered parameter.
 *
 * The manifest lives in `lib/manifest.ts` precisely so this file can read it. A `.tsx` cannot be
 * parsed by `node --test`, and a register nobody can test is a register that drifts.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "hirelane-tools-test-")));

const { annotationsFor } = await import("@athena/demo-kit/webmcp");
const { BOARD_CAPABILITIES, CAPABILITIES, PROTECTED_ATTRIBUTES, SHIPPED_CAPABILITIES, isAuto } =
  await import("../lib/manifest");
const { db } = await import("../lib/db");

/** The three acts that reach a person or end their process. Nothing else may join them. */
const GATED = ["decide_stage", "send_scheduling_email", "send_rejection"];

/**
 * Does this identifier name a protected attribute?
 *
 * Matched on WORDS, not on substrings, because `stage` contains `age` and `stage` is the whole
 * pipeline. An identifier is split on anything that is not a letter and each word is compared
 * whole; a word of five letters or more also matches what it starts (`photo` catches
 * `photograph`, `birth` catches `birthdate`), which is where the compound forms hide.
 */
const carries = (identifier: string): string | null => {
  const words = identifier.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of PROTECTED_ATTRIBUTES) {
    for (const part of words) {
      if (part === word || (word.length >= 5 && part.startsWith(word))) return word;
    }
  }
  return null;
};

test("both tool sets are one register, with no name registered twice", () => {
  const names: string[] = CAPABILITIES.map((c) => c.name);
  assert.equal(
    names.length,
    SHIPPED_CAPABILITIES.length + BOARD_CAPABILITIES.length,
    "the register is the union of the two sets",
  );
  assert.equal(new Set(names).size, names.length, `a name is registered twice: ${names.join(", ")}`);
  // Both sets mount on the one shipped route, so a collision would be two handlers under one name.
  for (const name of ["read_applicants", "read_shortlist", "score_against_rubric", "propose_slots"]) {
    assert.ok(names.includes(name), `${name} is on the register`);
  }
});

test("exactly three capabilities are GATED, and they are the three that cannot be taken back", () => {
  const gated = CAPABILITIES.filter((c) => !isAuto(c)).map((c) => c.name);
  assert.deepEqual(gated.sort(), [...GATED].sort());
});

test("the annotations a browser agent reads carry the class the foot prints", () => {
  for (const capability of CAPABILITIES) {
    const annotations = annotationsFor(capability);
    assert.equal(
      annotations.consequentialHint,
      !isAuto(capability),
      `${capability.name}: consequentialHint is the GATED half of the rule`,
    );
    // Both keys are always emitted: a consumer distinguishes `false` from absent, and an absent
    // annotation is unknown, and unknown is gated (demo-kit/src/webmcp/hooks.ts).
    assert.equal(typeof annotations.readOnlyHint, "boolean", `${capability.name}: readOnlyHint is stated`);
  }
});

test("every read is readOnly, and no read is consequential", () => {
  const reads = ["read_view", "read_applicants", "read_shortlist", "search_candidates", "set_filter"];
  for (const name of reads) {
    const capability = CAPABILITIES.find((c) => c.name === name)!;
    assert.ok(capability, `${name} is registered`);
    const annotations = annotationsFor(capability);
    assert.equal(annotations.readOnlyHint, true, `${name}: readOnlyHint`);
    assert.equal(annotations.consequentialHint, false, `${name}: not consequential`);
  }
});

test("the applicants table has no column that could carry a protected attribute", () => {
  const columns = db()
    .all<{ name: string }>("SELECT name FROM pragma_table_info('applicants')")
    .map((c) => c.name.toLowerCase());
  assert.ok(columns.includes("name"), "the pragma read the table, or this asserts nothing");
  for (const column of columns) {
    const word = carries(column);
    assert.equal(word, null, `applicants.${column} would carry "${word}"`);
  }
});

test("no registered tool accepts a protected attribute as a parameter", () => {
  for (const capability of CAPABILITIES) {
    for (const parameter of capability.parameters) {
      const word = carries(parameter.name);
      assert.equal(
        word,
        null,
        `${capability.name}(${parameter.name}) would let an agent address "${word}"`,
      );
    }
  }
});

test("search_candidates and set_filter take only pipeline facts, by name", () => {
  const allowed: Record<string, string[]> = {
    search_candidates: [
      "text",
      "role",
      "employer",
      "stage",
      "scored_at_least",
      "scored_at_most",
      "arguable",
      "unscored",
    ],
    set_filter: ["role", "arguable"],
    read_applicants: ["role_id", "stage", "borderline"],
    read_shortlist: ["role_id"],
  };
  for (const [name, expected] of Object.entries(allowed)) {
    const capability = CAPABILITIES.find((c) => c.name === name)!;
    assert.deepEqual(
      capability.parameters.map((p) => p.name),
      expected,
      `${name}'s parameters are exactly these, so a new one is a deliberate act`,
    );
  }
});

test("the two gated sends name the applicant and the thing being sent, and nothing else", () => {
  assert.deepEqual(
    CAPABILITIES.find((c) => c.name === "send_scheduling_email")!.parameters.map((p) => p.name),
    ["applicant_id", "slot_id"],
  );
  assert.deepEqual(
    CAPABILITIES.find((c) => c.name === "send_rejection")!.parameters.map((p) => p.name),
    ["applicant_id", "template"],
  );
});
