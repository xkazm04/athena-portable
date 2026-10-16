/**
 * The origins store's records — README section 3.3, ADR 0063: a row is in the table or it is
 * first sight, and `records` must not keep an answer the table no longer gives.
 *
 * The shell is mocked at `lib/ipc.ts`, as `tools.test.ts` does: the `store_*` commands answer from
 * an in-memory table, and the store and the run loop's readers above them are the code under test.
 */
import { beforeEach, expect, test, vi } from "vitest";

import type { Args } from "@/lib/ipc";
import type { OriginRow } from "@/lib/store";

/** The `origins` table as the shell holds it. */
let table: OriginRow[] = [];
/** When set, `store_set` on `origins` rejects with it. */
let writeFails: string | null = null;

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  const call = (command: string, args: Args = {}): Promise<unknown> => {
      const key = String(args.key ?? "");
      if (command === "store_list") {
        return Promise.resolve({ rows: args.table === "origins" ? table : [], showing: table.length, total: table.length });
      }
      if (command === "store_get") {
        return Promise.resolve(args.table === "origins" ? (table.find((r) => r.origin === key) ?? null) : null);
      }
      if (command === "store_set") {
        if (args.table === "origins" && writeFails) return Promise.reject(new Error(writeFails));
        return Promise.resolve(key);
      }
      if (command === "store_delete") {
        table = table.filter((r) => r.origin !== key);
        return Promise.resolve();
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
  };
  return {
    ...actual,
    hasShell: () => true,
    call,
    storeGetRow: (table: string, key: string) => call("store_get", { table, key }),
    storeSetRow: (table: string, key: string, value: unknown) => call("store_set", { table, key, value } as Args),
    storeListRows: (table: string, filter: Args = {}) => call("store_list", { table, filter }),
    storeDeleteRow: (table: string, key: string) => call("store_delete", { table, key }),
    on: () => Promise.resolve(() => {}),
  };
});

const { useOrigins } = await import("@/stores/origins");
const { disabledOriginsOf } = await import("@/stores/run");

const row = (origin: string, enabled: boolean): OriginRow => ({ origin, enabled, overrides: {}, first_seen: "", last_seen: "" });

beforeEach(() => {
  table = [];
  writeFails = null;
  useOrigins.setState({ records: {}, known: [], loaded: false, problem: null, contracts: {} });
});

test("an origin the other window forgot is no longer switched off here once the table is read again", async () => {
  table = [row("https://closed.local", false)];
  await useOrigins.getState().loadAll();
  expect(disabledOriginsOf(useOrigins.getState().records, [], {})).toEqual(["host:web_https_sclosed_dlocal"]);

  // The other window deleted the row and said so on `store:changed`; this window reads the table again.
  table = [];
  await useOrigins.getState().loadAll();

  expect(useOrigins.getState().known).toEqual([]);
  expect(useOrigins.getState().records).toEqual({});
  expect(disabledOriginsOf(useOrigins.getState().records, [], {})).toEqual([]);
});

test("a first answer whose write failed leaves the origin first sight, not switched off", async () => {
  writeFails = "database is locked";
  await expect(useOrigins.getState().setEnabled("https://new.local", true)).rejects.toThrow("database is locked");

  expect(useOrigins.getState().records["https://new.local"]).toBeUndefined();
  expect(disabledOriginsOf(useOrigins.getState().records, [], {})).toEqual([]);
});

test("a save still lands on the stored row, and the next save builds on it", async () => {
  table = [row("https://ledgerbox.local", true)];
  await useOrigins.getState().loadAll();

  await useOrigins.getState().setOverride("https://ledgerbox.local", "chase", "GATED");
  await useOrigins.getState().setEnabled("https://ledgerbox.local", false);

  const record = useOrigins.getState().records["https://ledgerbox.local"];
  expect(record.enabled).toBe(false);
  expect(record.overrides).toEqual({ chase: "GATED" });
  expect(useOrigins.getState().known).toEqual(["https://ledgerbox.local"]);
});
