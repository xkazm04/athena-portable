import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import { closeQuietly, why } from "./session";

describe("why", () => {
  it("says a busy daemon and a stale approve plainly", () => {
    expect(
      why(new ApiError(429, "budget_exhausted", "busy: 3 sessions live"))
        .reason,
    ).toBe("busy");
    expect(
      why(new ApiError(409, "validator_failed", "stale_rev: rev 2 is current"))
        .reason,
    ).toBe("stale_rev");
  });

  it("keeps any other refusal as the daemon said it", () => {
    expect(
      why(new ApiError(503, "engine_error", "claude is not installed")),
    ).toEqual({
      reason: "engine_error",
      detail: "claude is not installed",
    });
    expect(why(new ApiError(500, "offline", ""))).toEqual({
      reason: "offline",
      detail: "",
    });
    expect(why(new Error("boom"))).toEqual({
      reason: "unknown",
      detail: "boom",
    });
  });
});

describe("closeQuietly", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records a close the daemon refused or never answered, once, and throws nothing", async () => {
    const fault = vi.spyOn(console, "error").mockImplementation(() => {});
    closeQuietly({ close: () => Promise.reject(new Error("network down")) }, "ses_a", "left the studio");
    await vi.waitFor(() => expect(fault).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(String(fault.mock.calls[0]![0])).toMatch(/ses_a.*left the studio.*network down/);
  });

  it("stays quiet for a session the daemon no longer knows, and for a close that worked", async () => {
    const fault = vi.spyOn(console, "error").mockImplementation(() => {});
    closeQuietly({ close: () => Promise.reject(new ApiError(404, "unknown_ref", "no such session")) }, "ses_b", "x");
    closeQuietly({ close: () => Promise.resolve() }, "ses_c", "x");
    await new Promise((done) => setTimeout(done, 20));
    expect(fault).not.toHaveBeenCalled();
  });

  it("is the only way either session hook lets a session go: 8 sites, none swallowed", () => {
    const adopt = readFileSync(new URL("./session.ts", import.meta.url), "utf8");
    const intake = readFileSync(new URL("../intake/session.ts", import.meta.url), "utf8");
    for (const src of [adopt, intake]) expect(src).not.toMatch(/\.close\([^)]*\)\.catch\(\(\) => \{\}\)/);
    const calls = (src: string) => (src.match(/closeQuietly\(/g) ?? []).length;
    expect(calls(adopt) - 1 + calls(intake)).toBe(8);
  });
});
