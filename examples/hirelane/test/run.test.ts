/**
 * An act whose server action throws ends in a toast, not in a page that is gone.
 *
 * `useRun` ran every act - all seven on the dossier and every Undo - inside a transition, and
 * awaited the action with nothing around it. A server action that throws (the server restarted
 * under a dev rebuild, a request that never came back, a write the database refused) rejects that
 * transition, React hands the error to the nearest error boundary, and this app declares none: the
 * whole board was replaced by the framework's error page, and the person never learned whether
 * the act had gone through. `settle` turns the throw into a refusal the toast already knows how to
 * show, saying the one true thing - that the outcome is unknown - and where to look.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

// The kit's UI barrel carries .tsx, which this runner cannot load; `useRun` takes one hook from it.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@athena/demo-kit/ui") {
      return { url: "data:text/javascript,export function useToast(){return {toast(){}}}", shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { settle, NO_ANSWER } = await import("../components/board/useRun");
const { toastFor } = await import("../components/board/history");

test("a thrown action settles as a refusal that says the outcome is unknown", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await settle(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(result, { ok: false, message: NO_ANSWER });
    assert.match(NO_ANSWER, /unknown/, "it does not claim the act failed, or that it took");
    assert.match(NO_ANSWER, /History/, "and it says where to look");
    assert.deepEqual(toastFor(result), { text: NO_ANSWER, tone: "error" }, "an error toast, with no Undo on it");
  } finally {
    console.error = quiet;
  }
});

test("an answered action passes through untouched, refusals included", async () => {
  const answered = { ok: false, message: "Write something first." };
  assert.equal(await settle(() => Promise.resolve(answered)), answered);
});

test("every act and every Undo in useRun is awaited through settle", () => {
  const source = readFileSync(new URL("../components/board/useRun.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(source, /await settle\(fn\)/, "run");
  assert.match(source, /await settle\(\(\) => undoAction\(id[,)]/, "undo");
  assert.doesNotMatch(source, /await fn\(\)|await undoAction\(/, "and nothing awaits an action bare");
});
