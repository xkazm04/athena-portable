// zoomTools' open_item: `group` is optional by its own description, so a call that omits it
// must pass the validating execute door (door.ts) and not be refused as a missing argument.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateArgs } from "../src/webmcp/door.ts";
import { parametersToJsonSchema, type HostParameter } from "../src/webmcp/types.ts";

test("open_item without a group passes validation, and a stray key does not", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/webmcp/zoomTools.ts", import.meta.url)), "utf8");
  const block = src.slice(src.indexOf('name: "open_item"'));
  const start = block.indexOf("parameters: [") + "parameters: ".length;
  const end = block.indexOf("],", start) + 1;
  const params = new Function("itemNoun", "groupNoun", `return ${block.slice(start, end)}`)(
    "item",
    "group",
  ) as HostParameter[];
  const schema = parametersToJsonSchema(params);

  assert.deepEqual(schema.required, ["id"]);
  assert.equal(validateArgs({ id: "a" }, schema), null);
  assert.equal(validateArgs({ id: "a", group: "g" }, schema), null);
  assert.match(validateArgs({ group: "g" }, schema) ?? "", /missing required argument "id"/);
});
