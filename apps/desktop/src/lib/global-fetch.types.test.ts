/**
 * The one `globalFetch` the desktop API clients share. It must look `fetch` up at call time, so a
 * test that stubs the global after import still sees its stub, and it must forward its arguments.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { globalFetch } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("globalFetch", () => {
  it("is a function that forwards its arguments to the global fetch stubbed after import", async () => {
    const response = new Response("{}", { status: 200 });
    const stub = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal("fetch", stub);

    const init = { method: "POST" };
    await expect(globalFetch("http://127.0.0.1:1/x", init)).resolves.toBe(response);

    expect(typeof globalFetch).toBe("function");
    expect(stub).toHaveBeenCalledWith("http://127.0.0.1:1/x", init);
  });
});
