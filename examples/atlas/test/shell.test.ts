/**
 * THE SHELL — the tool surface, the mount and the stylesheets that every variant shares.
 *
 * `node --test` strips TypeScript and not JSX, so the shell's components cannot be rendered here.
 * What can be checked is what they publish (the tool schemas, which live in `tools/read.ts` and go
 * through the kit's own execute door) and their source with comments stripped, so prose that
 * mentions a rule cannot satisfy the check for it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CONCEPTS } from "../data";
import { CLEAR_LENS, SET_LENS_PARAMETERS } from "../components/atlas/tools/read";
import { validateArgs } from "../../demo-kit/src/webmcp/door";
import { parametersToJsonSchema } from "../../demo-kit/src/webmcp/types";

/* ------------------------------------------------------------------ the tool surface -- */

test("set_lens's schema accepts the word its description says clears the lens", () => {
  const schema = parametersToJsonSchema(SET_LENS_PARAMETERS);
  const described = SET_LENS_PARAMETERS[0]!.description ?? "";
  assert.ok(described.includes(`"${CLEAR_LENS}"`), "the description no longer names the clear word");
  assert.equal(validateArgs({ concept: CLEAR_LENS }, schema), null);
});

test("set_lens's schema accepts every concept id and nothing else", () => {
  const schema = parametersToJsonSchema(SET_LENS_PARAMETERS);
  for (const c of CONCEPTS) assert.equal(validateArgs({ concept: c.id }, schema), null, c.id);
  assert.equal(validateArgs({}, schema), null, "omitting the concept is the read");
  assert.notEqual(validateArgs({ concept: "inv-nope" }, schema), null);
});
