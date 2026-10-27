/**
 * The mid-turn classifier (fleet-surfaces, ADR 0141): a correction interrupts, anything else queues.
 */
import { describe, expect, it } from "vitest";

import { classifyMidTurn } from "./midturn";

describe("classifyMidTurn", () => {
  const interrupts = [
    "stop",
    "Stop!",
    "STOP.",
    "wait",
    "Wait, the other invoice",
    "hold on",
    "Hold on, that's the wrong client",
    "cancel that",
    "never mind",
    "Nevermind, I'll do it",
    "actually, make it five",
    "instead, send it to Ana",
    "no",
    "No.",
    "no, the paid ones",
    "don't send it",
    "Don’t send it",
    "do not pay that one",
    "ok wait",
    "Okay, stop",
    "please stop",
    "oh wait, wrong month",
    "please just stop",
    "I said stop",
    "do the March ones instead",
    "use Ana's address instead.",
  ];
  const queues = [
    "",
    "   ",
    "and then email the summary",
    "what about the paid ones?",
    "How is Cancel going?",
    "How is Stop the sync going?",
    "no problem, also check March",
    "now the overdue list",
    "stopwatch app next",
    "what does waiting time mean in this report?",
    "cancellation fees for last month",
    "Thanks!",
    "also look at the contacts page and tell me who is new",
    "stop-loss orders for March next",
    "wait-list the new signups after this",
    "cancel-by dates for the open invoices",
  ];

  it.each(interrupts)("interrupts on %j", (text) => {
    expect(classifyMidTurn(text)).toBe("interrupt");
  });

  it.each(queues)("queues %j", (text) => {
    expect(classifyMidTurn(text)).toBe("queue");
  });
});
