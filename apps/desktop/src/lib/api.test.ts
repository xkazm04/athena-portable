/**
 * `DaemonApi`'s default `fetch` — the one line in `lib/api.ts` no test used to execute.
 *
 * THE BUG THIS FILE EXISTS FOR. The default parameter was the bare global: `fetchImpl = fetch`.
 * That stores the function as an instance property, so `this.fetchImpl(...)` calls it with `this`
 * bound to the `DaemonApi` — and `fetch` is a method of `Window`, which refuses any other
 * receiver. Every call through the default threw, always:
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * It reached a person because the seam that makes this client testable is also what hid it: every
 * other test constructs `new DaemonApi(endpoint, fake)`, and the three production call sites —
 * `stores/connectors.ts`, `stores/run.ts`, `stores/voice.ts` — are the only ones that take the
 * default. The tested path and the shipped path were different lines.
 *
 * So this asserts the default specifically, and asserts the property that was actually broken: the
 * receiver. `expect(...).resolves` on a happy path would have passed against the bug in Node,
 * where `fetch` is a plain global function and does not care what `this` is — which is the second
 * half of why this was invisible under vitest. The check is therefore on the RECEIVER the client
 * hands the global, not on the response.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonApi } from "./api";

const ENDPOINT = { url: "http://127.0.0.1:17490", token: "t" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the default fetch", () => {
  it("calls the global with the global as its receiver, never with the client", async () => {
    const seen: unknown[] = [];
    // A stub that records what `this` was at the call site. A real `Window.fetch` would throw on
    // anything but the global; recording it is how we assert the same fact in Node.
    const stub = vi.fn(function (this: unknown) {
      seen.push(this);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", stub);

    await new DaemonApi(ENDPOINT).connectors();

    expect(stub).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(1);
    // Not the DaemonApi instance. That is the whole assertion: `this.fetchImpl(...)` on a stored
    // bare global is what produced "Illegal invocation" in a webview.
    expect(seen[0]).not.toBeInstanceOf(DaemonApi);
    expect(seen[0] === globalThis || seen[0] === undefined).toBe(true);
  });

  it("reaches the endpoint and carries the token", async () => {
    const stub = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ connectors: [] }), { status: 200 })));
    vi.stubGlobal("fetch", stub);

    await new DaemonApi(ENDPOINT).connectors();

    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:17490/connectors");
    expect((init.headers as Record<string, string>)["X-Athena-Token"]).toBe("t");
  });

  it("an injected fetch still wins over the default", async () => {
    const injected = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const global = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", global);

    await new DaemonApi(ENDPOINT, injected).health();

    expect(injected).toHaveBeenCalledOnce();
    expect(global).not.toHaveBeenCalled();
  });
});
