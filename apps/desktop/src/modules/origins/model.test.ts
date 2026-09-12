/**
 * The Origins module's selector.
 *
 * The two things asserted hardest are the two a reader would otherwise have to trust: that the
 * detail offers only tightening rulings and says why when it offers none, and that a stored
 * ruling whose tool is not currently on offer still appears — that set is exactly what a user
 * comes to this page to undo, and a list built from the live manifest alone would lose it.
 */
import { expect, test, vi } from "vitest";

import type { OriginRow as StoredOrigin } from "@/lib/store";
import type { ToolRow } from "@/stores/run";

import { INERT_ACTIONS, dayOf, selectOrigins, type OriginsSources } from "./model";

const A = "https://invoices.example.test";
const B = "https://support.example.test";

function stored(origin: string, over: Partial<Omit<StoredOrigin, "origin">> = {}): StoredOrigin {
  return {
    origin,
    enabled: true,
    overrides: {},
    first_seen: "2026-02-11T09:14:02Z",
    last_seen: "2026-03-04T18:20:41Z",
    ...over,
  };
}

function tool(over: Partial<ToolRow> & Pick<ToolRow, "name" | "declaredCls">): ToolRow {
  return {
    origin: A,
    description: "",
    tier: 1,
    overrideCls: null,
    effectiveCls: over.declaredCls,
    transport: "webmcp-polyfill",
    ...over,
  };
}

function sources(over: Partial<OriginsSources> = {}): OriginsSources {
  return {
    known: [A, B],
    records: { [A]: stored(A), [B]: stored(B, { enabled: false }) },
    loaded: true,
    problem: null,
    tools: [],
    currentOrigin: A,
    selected: null,
    actions: INERT_ACTIONS,
    ...over,
  };
}

test("one row per stored origin, in the table's own order, with the trusted count derived", () => {
  const model = selectOrigins(sources());
  expect(model.origins.map((o) => o.origin)).toEqual([A, B]);
  expect(model.origins[0].host).toBe("invoices.example.test");
  expect(model.trusted).toBe(1);
  expect(model.origins[0].current).toBe(true);
  expect(model.origins[1].current).toBe(false);
});

test("an origin the table names but does not hold is dropped rather than rendered blank", () => {
  const model = selectOrigins(sources({ known: [A, B, "https://gone.example.test"] }));
  expect(model.origins).toHaveLength(2);
});

test("a tool count is null when the page is not open, which is not the same fact as zero", () => {
  const closed = selectOrigins(sources());
  expect(closed.origins[0].toolCount).toBeNull();

  const open = selectOrigins(sources({ tools: [tool({ name: "list", declaredCls: "READ" })] }));
  expect(open.origins[0].toolCount).toBe(1);
  expect(open.origins[1].toolCount).toBeNull();
});

test("the ruled count is the stored overrides, whether or not the page is open", () => {
  const model = selectOrigins(
    sources({ records: { [A]: stored(A, { overrides: { page_fill: "GATED" } }), [B]: stored(B) } }),
  );
  expect(model.origins[0].overrideCount).toBe(1);
});

// -- the detail, and the tighten-only rule ------------------------------------------------------

test("a detail offers only classes tighter than the declared one", () => {
  const model = selectOrigins(
    sources({
      selected: A,
      tools: [
        tool({ name: "open_invoice", declaredCls: "AUTO" }),
        tool({ name: "list_invoices", declaredCls: "READ" }),
        tool({ name: "send_reminder", declaredCls: "GATED" }),
      ],
    }),
  );
  const rows = model.selected!.overrides;
  expect(rows.map((r) => r.tool)).toEqual(["open_invoice", "list_invoices", "send_reminder"]);
  expect(rows[0].allowed).toEqual(["READ", "GATED"]);
  expect(rows[1].allowed).toEqual(["GATED"]);
  expect(rows[2].allowed).toEqual([]);
  expect(rows[2].lockedReason).toContain("tightest");
  expect(rows[0].lockedReason).toBeNull();
});

test("a ruling on a tool the page is not offering survives, with nothing claimed about it", () => {
  const model = selectOrigins(
    sources({
      selected: A,
      records: { [A]: stored(A, { overrides: { export_all: "GATED" } }), [B]: stored(B) },
      tools: [tool({ name: "list_invoices", declaredCls: "READ" })],
    }),
  );
  const orphan = model.selected!.overrides.find((r) => r.tool === "export_all")!;
  expect(orphan.declaredCls).toBeNull();
  expect(orphan.effectiveCls).toBeNull();
  expect(orphan.tier).toBeNull();
  expect(orphan.allowed).toEqual([]);
  expect(orphan.lockedReason).toContain("not open");
  expect(orphan.overrideCls).toBe("GATED");
});

test("a detail with no live manifest at all says so", () => {
  const model = selectOrigins(
    sources({ selected: A, records: { [A]: stored(A, { overrides: { a: "GATED" } }) } }),
  );
  expect(model.selected!.offline).toBe(true);
});

test("the effective class is the ruling where it tightens, and the declared class where it does not", () => {
  const model = selectOrigins(
    sources({
      selected: A,
      records: {
        [A]: stored(A, { overrides: { open_invoice: "GATED", send_reminder: "AUTO" } }),
        [B]: stored(B),
      },
      tools: [
        tool({ name: "open_invoice", declaredCls: "AUTO" }),
        tool({ name: "send_reminder", declaredCls: "GATED" }),
      ],
    }),
  );
  const [tightened, overtaken] = model.selected!.overrides;
  expect(tightened.effectiveCls).toBe("GATED");
  expect(tightened.ignored).toBe(false);
  // The page re-registered `send_reminder` as GATED after the user had pinned it AUTO.
  expect(overtaken.effectiveCls).toBe("GATED");
  expect(overtaken.ignored).toBe(true);
});

test("selecting an origin the table does not hold is no detail, not a thrown render", () => {
  expect(selectOrigins(sources({ selected: "https://nowhere.example.test" })).selected).toBeNull();
});

// -- the two failure facts ----------------------------------------------------------------------

test("a table that could not be read keeps its reason and is not an empty list", () => {
  const model = selectOrigins(sources({ known: [], records: {}, problem: "store_unavailable" }));
  expect(model.problem).toBe("store_unavailable");
  expect(model.origins).toEqual([]);
  expect(model.loaded).toBe(true);
});

test("a day is the stored instant's own first ten characters, and an unwritten row has none", () => {
  expect(dayOf("2026-02-11T09:14:02Z")).toBe("2026-02-11");
  expect(dayOf("")).toBeNull();
  expect(dayOf("not a date")).toBeNull();
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions = { ...INERT_ACTIONS, forget: vi.fn(), setOverride: vi.fn() };
  const model = selectOrigins(sources({ actions }));
  model.actions.forget(A);
  model.actions.setOverride(A, "page_fill", "GATED");
  expect(actions.forget).toHaveBeenCalledWith(A);
  expect(actions.setOverride).toHaveBeenCalledWith(A, "page_fill", "GATED");
});
