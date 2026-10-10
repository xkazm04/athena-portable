/** `readCapture` reads the row the shell filed and says in a sentence why when it cannot (ADR 0066). */
import { beforeEach, expect, test, vi } from "vitest";

let shell = true;
let row: { png: string | null } | null = null;
let failure: Error | null = null;

vi.mock("@/lib/ipc", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ipc")>()), hasShell: () => shell }));
vi.mock("@/lib/store", () => ({
  storeGet: async () => {
    if (failure) throw failure;
    return row;
  },
}));

const { readCapture } = await import("./capture");

beforeEach(() => {
  shell = true;
  row = null;
  failure = null;
});

test("a filed capture becomes a data URL", async () => {
  row = { png: "AAAA" };
  expect(await readCapture("cap_0123456789ab")).toEqual({ src: "data:image/png;base64,AAAA", problem: null });
});

test("a capture the sweep removed, a failed read and a missing shell each say so", async () => {
  expect((await readCapture("cap_0123456789ab")).problem).toBe("the capture is no longer kept");
  failure = new Error("database is locked");
  expect((await readCapture("cap_0123456789ab")).problem).toContain("database is locked");
  shell = false;
  expect((await readCapture("cap_0123456789ab")).problem).toContain("cannot read the store");
});
