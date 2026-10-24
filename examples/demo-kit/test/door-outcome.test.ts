// The execute descriptor `useWebMCPTool` registers: a refusal or a fault REJECTS (the bridge's
// coded `{ ok: false, reason?, error }` path), a domain answer RESOLVES (ADR 0146).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hooks.ts imports its siblings without an extension (Next resolves those); supply that and
// nothing else, so the code under test is the source the apps ship.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { toolDescriptorFor } = await import("../src/webmcp/hooks.ts");
const { ToolRefusal } = await import("../src/webmcp/door.ts");

type Handler = (args: Record<string, unknown>, context: { signal?: AbortSignal }) => unknown;

function descriptor(handler: Handler, options?: { ceilingMs?: number }) {
  const spec = {
    name: "move_card",
    description: "Move a card to a stage.",
    parameters: [{ name: "stage", enum: ["new", "hired"], required: true }],
    reversible: true,
    sideEffects: "data" as const,
    handler,
  };
  return toolDescriptorFor(spec, { current: handler }, undefined, options);
}

test("a refused argument rejects a ToolRefusal listing every mismatch by path, and the handler never runs", async () => {
  let ran = 0;
  const d = descriptor(() => (ran++, "ran"));
  const error = await d.execute({ stage: "gone", extra: 1 }, {}).then(
    () => assert.fail("a refused call must reject"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ToolRefusal, "a ToolRefusal");
  const refusal = error as InstanceType<typeof ToolRefusal>;
  assert.equal(refusal.reason, "validator_failed");
  assert.equal(refusal.errors.length, 2, JSON.stringify(refusal.errors));
  const at = (path: string) => refusal.errors.find((e) => e.path === path);
  assert.equal(at("stage")?.code, "enum");
  assert.match(at("stage")?.message ?? "", /"stage" must be one of "new", "hired"/);
  assert.equal(at("extra")?.code, "unknown");
  assert.match(at("extra")?.message ?? "", /unknown argument "extra"/);
  assert.equal(ran, 0);
});

test("a handler throw rejects 'tool failed: <message>' carrying no reason", async (t) => {
  t.mock.method(console, "error", () => {});
  const d = descriptor(() => {
    throw new Error("boom");
  });
  const error = await d.execute({ stage: "new" }, {}).then(
    (out) => assert.fail(`resolved ${String(out)}`),
    (e: unknown) => e,
  );
  assert.ok(error instanceof Error);
  assert.equal((error as Error).message, "tool failed: boom");
  assert.equal("reason" in (error as object), false, "a tool's own fault, not a refusal");
});

test("with no caller signal, a handler that never settles is refused 'timeout' at the door's ceiling", async () => {
  const d = descriptor(() => new Promise(() => {}), { ceilingMs: 50 });
  const started = Date.now();
  const error = await d.execute({ stage: "new" }, {}).then(
    (out) => assert.fail(`resolved ${String(out)}`),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ToolRefusal);
  assert.equal((error as InstanceType<typeof ToolRefusal>).reason, "timeout");
  assert.ok(Date.now() - started >= 45, "at the ceiling, not before");
});

test("the caller's abort mid-run rejects 'cancelled', not resolved 'aborted' text", async () => {
  const controller = new AbortController();
  const d = descriptor(() => new Promise(() => {}));
  const pending = d.execute({ stage: "new" }, { signal: controller.signal });
  controller.abort();
  const error = await pending.then(
    (out) => assert.fail(`resolved ${String(out)}`),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ToolRefusal);
  assert.equal((error as InstanceType<typeof ToolRefusal>).reason, "cancelled");
});

test("a handler that returns a domain answer {ok:false} resolves it as text: a domain answer stays an answer", async () => {
  const answer = { ok: false, error: "No area with id x", available: ["a", "b"] };
  const d = descriptor(() => answer);
  assert.equal(await d.execute({ stage: "new" }, {}), JSON.stringify(answer));
});
