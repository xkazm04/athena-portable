// demo-kit-ui-webmcp: the page's tool door (webmcp/), the UI primitives (ui/), the activity log
// and the database handle, pinned where a scan-sweep round found one rule with two readings.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { validateArgs } from "../src/webmcp/door.ts";
import { classifyTool, parametersToJsonSchema, type SideEffects } from "../src/webmcp/types.ts";

// The modules under test import their siblings without an extension (Next resolves those) and
// the server half imports the `server-only` build marker. Supply both, and nothing else, so the
// code under test is the source the apps ship. Registered before any dynamic import below.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { annotationsFor, athenaFor } = await import("../src/webmcp/hooks.ts");
// The consumer the `athena` block and the annotations are written for (README section 3.3).
const gate = (await import(new URL("../../../packages/athena-bridge/gate.js", import.meta.url).href)) as {
  flagsOf: (tool: unknown) => { reversible: boolean; side_effects: string; basis: string };
  classify: (flags: unknown) => "AUTO" | "GATED";
  SIDE_EFFECTS: readonly string[];
};

/* ------------------------------------------------------- the page's own claim -- */

const CLAIMS: { reversible: boolean; sideEffects: SideEffects }[] = [true, false].flatMap((reversible) =>
  (["none", "data", "external"] as const).map((sideEffects) => ({ reversible, sideEffects })),
);

test("the athena block speaks the contract's side_effects vocabulary, so the gate reads it first", () => {
  for (const claim of CLAIMS) {
    const block = athenaFor(claim);
    const label = `${claim.reversible ? "reversible" : "irreversible"} ${claim.sideEffects}`;
    assert.ok(gate.SIDE_EFFECTS.includes(block.side_effects), `${label}: ${block.side_effects} is not a contract value`);
    const flags = gate.flagsOf({ name: "t", athena: block, annotations: annotationsFor(claim) });
    assert.equal(flags.basis, "athena", label);
    assert.equal(flags.reversible, claim.reversible, label);
  }
});

test("the block, the annotations alone and classifyTool give every claim one class", () => {
  for (const claim of CLAIMS) {
    const label = `${claim.reversible ? "reversible" : "irreversible"} ${claim.sideEffects}`;
    const expected = classifyTool({ reversible: claim.reversible, side_effects: claim.sideEffects });
    assert.equal(gate.classify(gate.flagsOf({ name: "t", athena: athenaFor(claim) })), expected, `${label}, block`);
    // A native document.modelContext drops the non-standard block; the hints must say the same.
    assert.equal(gate.classify(gate.flagsOf({ name: "t", annotations: annotationsFor(claim) })), expected, `${label}, hints`);
  }
});

/* ------------------------------------------------------------- the execute door -- */

test("an array over the maxItems its schema publishes is refused at the door, naming the cap", () => {
  // mcp-tools/tool-schema-design: the schema published is the schema enforced. types.ts publishes
  // `maxItems` on every capped array; a native browser agent reaches the door without the bridge's
  // own check, so the cap has to hold here too or an over-long list is sliced by the handler.
  const schema = parametersToJsonSchema([{ name: "ids", type: "string[]", maxItems: 2 }]);
  assert.equal(validateArgs({ ids: ["a", "b"] }, schema), null);
  assert.match(validateArgs({ ids: ["a", "b", "c"] }, schema) ?? "", /"ids" has 3 items; at most 2/);
  const nested = parametersToJsonSchema([
    { name: "rows", type: "object[]", attributes: [{ name: "tags", type: "string[]", maxItems: 1 }] },
  ]);
  assert.match(validateArgs({ rows: [{ tags: ["x", "y"] }] }, nested) ?? "", /"rows\[0\]\.tags" has 2 items/);
});
