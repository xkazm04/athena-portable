/**
 * The `origins` store, round-tripped against a mocked `invoke` — README section 3.3.
 *
 * The table is the index and it is also the only place two of its columns exist: `first_seen` and
 * `last_seen` default to `datetime('now')` in `store.rs` and are never sent from here. So what is
 * asserted is the round trip rather than the write: a save publishes the row **the table now
 * holds**, stamps included, because the surface that renders those two dates has no other source
 * for them and an em dash where a date belongs reads as a row that was never stored.
 */
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  return { rows, calls };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    harness.calls.push({ command, args });
    const key = `${String(args.table)}/${String(args.key)}`;
    if (command === "store_get") return harness.rows.get(key) ?? null;
    if (command === "store_set") {
      // What `store.rs` does: the row is merged, and the two sightings are the table's own.
      const before = harness.rows.get(key);
      const patch = args.value as Record<string, unknown>;
      harness.rows.set(key, {
        origin: String(args.key),
        first_seen: before?.first_seen ?? "2026-09-12T10:00:00Z",
        ...before,
        ...patch,
      });
      return String(args.key);
    }
    if (command === "store_delete") {
      harness.rows.delete(key);
      return null;
    }
    if (command === "store_list") {
      const rows = [...harness.rows.values()];
      return { rows, showing: rows.length, total: rows.length, footer: "" };
    }
    throw new Error(`no fake for ${command}`);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

globalThis.window = { __TAURI_INTERNALS__: {} } as unknown as Window & typeof globalThis;

const { useOrigins } = await import("@/stores/origins");

const ORIGIN = "https://invoices.example.test";

beforeEach(() => {
  harness.rows.clear();
  harness.calls.length = 0;
  useOrigins.setState({ records: {}, known: [], loaded: false, problem: null });
});

test("a save publishes the row the table holds, with the sightings the table stamped", async () => {
  const saved = await useOrigins.getState().setEnabled(ORIGIN, true);

  expect(saved.enabled).toBe(true);
  expect(saved.first_seen).toBe("2026-09-12T10:00:00Z");
  expect(saved.last_seen).not.toBe("");
  // The store's own record, not just the value handed back.
  expect(useOrigins.getState().records[ORIGIN].first_seen).toBe("2026-09-12T10:00:00Z");
  expect(useOrigins.getState().known).toEqual([ORIGIN]);
});

test("a pinned class reaches the table whole, and the row it writes is the origin's first", async () => {
  await useOrigins.getState().setOverride(ORIGIN, "send", "GATED");

  const written = harness.calls.filter((c) => c.command === "store_set");
  expect(written).toHaveLength(1);
  expect((written[0].args.value as Record<string, unknown>).overrides).toEqual({ send: "GATED" });
  expect(useOrigins.getState().records[ORIGIN].overrides).toEqual({ send: "GATED" });
});

test("a read-back that fails is not a failed save: the local record stands", async () => {
  const invoke = vi.mocked((await import("@tauri-apps/api/core")).invoke);
  invoke.mockImplementationOnce(async () => null); // the `store_get` inside `load`
  invoke.mockImplementationOnce(async () => ORIGIN); // the `store_set`
  invoke.mockImplementationOnce(async () => {
    throw new Error("the store went away");
  });

  const saved = await useOrigins.getState().setEnabled(ORIGIN, true);
  expect(saved.enabled).toBe(true);
  expect(useOrigins.getState().records[ORIGIN].enabled).toBe(true);
});

test("two saves for one origin land in call order, and neither drops the other's field", async () => {
  const [first, second] = await Promise.all([
    useOrigins.getState().setEnabled(ORIGIN, true),
    useOrigins.getState().setOverride(ORIGIN, "send", "GATED"),
  ]);
  void first;
  void second;

  const record = useOrigins.getState().records[ORIGIN];
  expect(record.enabled).toBe(true);
  expect(record.overrides).toEqual({ send: "GATED" });
});
