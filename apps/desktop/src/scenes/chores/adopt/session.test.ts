import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import { why } from "./session";

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
