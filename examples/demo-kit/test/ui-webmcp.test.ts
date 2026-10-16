// demo-kit-ui-webmcp: the page's tool door (webmcp/), the UI primitives (ui/), the activity log
// and the database handle, pinned where a scan-sweep round found one rule with two readings.
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateArgs } from "../src/webmcp/door.ts";
import { parametersToJsonSchema } from "../src/webmcp/types.ts";

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
