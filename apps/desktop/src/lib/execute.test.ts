/**
 * The host-call executor (ADR 0101): the timeout reading, the hold and the unsure registry, as
 * values. The two stores that drive it are tested in `stores/run.test.ts` and
 * `stores/voice.test.ts`; this pins the rules themselves.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import { setHandsForTests } from "@/lib/hands";

import {
  clearUnsureForTests,
  forgetUnsure,
  heldBefore,
  isReadCall,
  readTimeout,
  rememberUnsure,
  settleHostCall,
  unsureTools,
  withUnsure,
} from "./execute";

const flagged = (name: string, athena: Record<string, unknown> | null): BridgeTool => ({
  name,
  title: name,
  description: `${name}.`,
  inputSchema: {},
  annotations: null,
  athena,
});

const PAY = flagged("pay", { reversible: false, side_effects: "external" });
const LIST = flagged("list_overdue", { reversible: true, side_effects: "none" });
const TIMED_OUT = { ok: false, output: "", error: "pay did not answer within 30000 ms", reason: "timeout" };

beforeEach(() => clearUnsureForTests());
afterEach(() => setHandsForTests([]));

describe("readTimeout", () => {
  it("a timeout on a write is outcome_unknown, on a read a timeout, an ok answer neither", () => {
    expect(readTimeout({ ok: false, output: "", reason: "timeout" }, false)).toBe("outcome_unknown");
    expect(readTimeout({ ok: false, output: "", reason: "timeout" }, true)).toBe("timeout");
    expect(readTimeout({ ok: true, output: "" }, false)).toBeNull();
    expect(readTimeout({ ok: false, output: "", error: "timeout" }, false)).toBe("outcome_unknown");
    expect(readTimeout({ ok: false, output: "", error: "validator_failed: no" }, false)).toBeNull();
  });

  it("a tool no listing describes is not a read, so its timeout is outcome_unknown", () => {
    expect(isReadCall("pay", [])).toBe(false);
    expect(readTimeout({ ok: false, output: "", reason: "timeout" }, isReadCall("pay", []))).toBe("outcome_unknown");
    expect(isReadCall("list_overdue", [LIST])).toBe(true);
    expect(isReadCall("pay", [PAY])).toBe(false);
  });

  it("a hand the page did not register is read from the hands' own flags", () => {
    setHandsForTests([flagged("page_read", { reversible: true, side_effects: "none" })]);
    expect(isReadCall("page_read", [])).toBe(true);
  });
});

describe("settleHostCall", () => {
  it("a write that timed out says it may have completed and asks to be remembered", () => {
    const out = settleHostCall("host.ledgerbox.pay", TIMED_OUT, [PAY]);
    expect(out.timeout).toBe("outcome_unknown");
    expect(out.error).toBe("outcome_unknown: pay did not answer within 30000 ms");
    expect(out.line).toBe("may have completed: no answer before the deadline");
  });

  it("a read that timed out is a plain timeout with the deadline named when the page gave no words", () => {
    const out = settleHostCall("host.ledgerbox.list_overdue", { ok: false, output: "", error: "timeout" }, [LIST]);
    expect(out.timeout).toBe("timeout");
    expect(out.error).toBe("timeout: no answer before the deadline");
    expect(out.line).toBe("timeout: no answer before the deadline");
  });

  it("an ok answer and a plain failure pass through untouched", () => {
    expect(settleHostCall("host.ledgerbox.pay", { ok: true, output: "paid" }, [PAY])).toEqual({
      timeout: null,
      error: null,
      line: "paid",
    });
    expect(settleHostCall("host.ledgerbox.pay", { ok: false, output: "", error: "validator_failed: x" }, [PAY])).toEqual({
      timeout: null,
      error: "validator_failed: x",
      line: "validator_failed: x",
    });
    expect(settleHostCall("host.ledgerbox.pay", { ok: false, output: "" }, [PAY]).line).toBe("failed");
  });
});

describe("the unsure hold", () => {
  it("holds an unsure tool until a card for it is answered, and an approved call is never held", () => {
    expect(heldBefore("host.ledgerbox.pay", false)).toBeNull();
    rememberUnsure({ origin: "https://ledgerbox.local", tool: "host.ledgerbox.pay", at: "" });

    const held = heldBefore("host.ledgerbox.pay", false);
    expect(held?.error).toMatch(/^outcome_unknown: host.ledgerbox.pay may already have run/);
    expect(held?.line).toBe("held: it may already have run");
    expect(heldBefore("host.ledgerbox.pay", true)).toBeNull();
    expect(heldBefore("host.ledgerbox.list_overdue", false)).toBeNull();

    forgetUnsure("host.ledgerbox.pay");
    expect(heldBefore("host.ledgerbox.pay", false)).toBeNull();
  });

  it("withUnsure only ever adds to gated_tools, sorted, and leaves the origins as they were", () => {
    const lists = { gated_origins: ["host:crm"], gated_tools: ["host.inbox.send"] };
    expect(withUnsure(lists)).toBe(lists);
    rememberUnsure({ origin: "https://ledgerbox.local", tool: "host.ledgerbox.pay", at: "" });
    rememberUnsure({ origin: "https://inbox.local", tool: "host.inbox.send", at: "" });
    expect(withUnsure(lists)).toEqual({
      gated_origins: ["host:crm"],
      gated_tools: ["host.inbox.send", "host.ledgerbox.pay"],
    });
    expect(unsureTools().map((u) => u.tool)).toEqual(["host.ledgerbox.pay", "host.inbox.send"]);
  });
});
