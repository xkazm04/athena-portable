/**
 * The type-level half of `ipc.ts` rule 1 — README section 3.5, "`store_set` lost an `undefined`
 * argument at the IPC boundary".
 *
 * `@ts-expect-error` is an assertion, not a suppression: if `Wire` ever grows an `undefined`
 * member the annotated line stops being an error and `pnpm typecheck` fails on the unused
 * directive. So this file is checked by `tsc`, and vitest runs it only to keep it from rotting
 * unnoticed in a directory nothing imports.
 */
import { expect, test } from "vitest";

import type { Args, Wire } from "./ipc";

test("null is on the wire and undefined is not", () => {
  const empty: Wire = null;
  const nested: Args = { value: { list: [1, "two", false, null] } };

  // @ts-expect-error — undefined has no JSON spelling; `null` is the only empty value.
  const lost: Args = { value: undefined };

  // @ts-expect-error — and it is not smuggled in a nested position either.
  const alsoLost: Args = { value: { inner: undefined } };

  expect(empty).toBeNull();
  expect(nested.value).toEqual({ list: [1, "two", false, null] });
  expect(lost).toBeDefined();
  expect(alsoLost).toBeDefined();
});
