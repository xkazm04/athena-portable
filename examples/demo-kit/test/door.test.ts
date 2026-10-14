// The WebMCP execute door: validate at dispatch, fault -> in-band error, bounded result.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_RESULT_CHARS, runTool } from "../src/webmcp/door.ts";

const err = async (...a: Parameters<typeof runTool>) => (JSON.parse(await runTool(...a)) as { error: string }).error;

const schema = {
  type: "object",
  properties: { stage: { type: "string", enum: ["new", "hired"] }, n: { type: "number" } },
  required: ["stage"],
};

test("wrong-typed, out-of-enum, missing and unknown arguments are refused naming the argument", async () => {
  let ran = 0;
  const h = () => (ran++, "ran");
  assert.match(await err(schema, { stage: "gone" }, h), /"stage" must be one of "new", "hired"/);
  assert.match(await err(schema, { stage: "new", n: "3" }, h), /"n" must be number/);
  assert.match(await err(schema, {}, h), /missing required argument "stage"/);
  assert.match(await err(schema, { stage: "new", extra: 1 }, h), /unknown argument "extra"/);
  assert.equal(ran, 0);
  assert.equal(await runTool(schema, { stage: "new", n: 2 }, h), "ran");
});

test("a handler throw returns an in-band error instead of throwing", async () => {
  const out = await runTool(schema, { stage: "new" }, () => {
    throw new Error("boom");
  });
  assert.deepEqual(JSON.parse(out), { ok: false, error: "tool failed: boom" });
});

test("an oversize result is cut and says how much", async () => {
  const out = await runTool(schema, { stage: "new" }, () => "x".repeat(MAX_RESULT_CHARS + 500));
  assert.ok(out.length < MAX_RESULT_CHARS + 200);
  assert.match(out, new RegExp(`truncated: showing ${MAX_RESULT_CHARS} of ${MAX_RESULT_CHARS + 500}`));
});
