// @vitest-environment jsdom
/**
 * The table's selection and sort — house style §3.2, ADR 0096. The table holds no state: a pick and
 * a sort are reported, and the caller hands them back, which is what this harness does.
 */
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import Table, { type Column, type TableSort } from "./Table";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  id: string;
  name: string;
  value: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", value: 3 },
  { id: "b", name: "Beta", value: 1 },
  { id: "c", name: "Gamma", value: 2 },
];

const COLUMNS: Column<Row>[] = [
  { key: "name", head: "Name", render: (r) => r.name },
  { key: "value", head: "Value", align: "right", sortable: true, render: (r) => r.value },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

/** A caller that keeps the pick, as a scene would. */
function Picking({ onSelect, initial = null }: { onSelect: (row: Row) => void; initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <Table
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      empty="Nothing here."
      selectedKey={selected}
      onSelect={(row) => {
        setSelected(row.id);
        onSelect(row);
      }}
    />
  );
}

const bodyRows = (h: HTMLElement) => [...h.querySelectorAll<HTMLTableRowElement>("tbody tr")];
const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

it("says its empty sentence across every column when there are no rows", () => {
  const h = renderToStaticMarkup(<Table columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty="Nothing here." />);
  expect(h).toContain('colSpan="2"');
  expect(h).toContain("Nothing here.");
});

it("leaves a table without onSelect as it was: no role, no tab stop, no aria-selected", () => {
  const h = renderToStaticMarkup(<Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} empty="Nothing here." />);
  expect(h).not.toContain("role=");
  expect(h).not.toContain("tabindex");
  expect(h).not.toContain("aria-selected");
  // A sortable column with no onSort is a plain head.
  expect(h).not.toContain("aria-sort");
  expect(h).not.toContain("<button");
});

it("picks a row on a click and marks it selected, with the one tab stop on it", () => {
  const onSelect = vi.fn();
  const h = mount(<Picking onSelect={onSelect} />);
  expect(h.querySelector("table")?.getAttribute("role")).toBe("grid");
  let rows = bodyRows(h);
  expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "false"]);
  act(() => rows[2]!.click());
  expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
  rows = bodyRows(h);
  expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
  expect(rows.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
});

it("moves the pick and the focus with the arrows, Home and End, and stops at the ends", () => {
  const onSelect = vi.fn();
  const h = mount(<Picking onSelect={onSelect} initial="a" />);
  press(bodyRows(h)[0]!, "ArrowDown");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[1]);
  expect(document.activeElement).toBe(bodyRows(h)[1]);
  expect(bodyRows(h)[1]!.getAttribute("aria-selected")).toBe("true");
  press(bodyRows(h)[1]!, "End");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[2]);
  expect(document.activeElement).toBe(bodyRows(h)[2]);
  press(bodyRows(h)[2]!, "ArrowDown");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[2]);
  press(bodyRows(h)[2]!, "Home");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[0]);
  press(bodyRows(h)[0]!, "ArrowUp");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[0]);
  expect(document.activeElement).toBe(bodyRows(h)[0]);
});

it("picks the focused row with Enter or Space, and leaves a key inside a cell's control alone", () => {
  const onSelect = vi.fn();
  const h = mount(<Picking onSelect={onSelect} />);
  press(bodyRows(h)[1]!, "Enter");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[1]);
  press(bodyRows(h)[2]!, " ");
  expect(onSelect).toHaveBeenLastCalledWith(ROWS[2]);
  expect(onSelect).toHaveBeenCalledTimes(2);
  press(bodyRows(h)[0]!, "x");
  expect(onSelect).toHaveBeenCalledTimes(2);
  // A key that bubbles up from inside a cell is not the row's.
  press(bodyRows(h)[0]!.querySelector("td")!, "Enter");
  expect(onSelect).toHaveBeenCalledTimes(2);
});

it("marks the sorted column with aria-sort and asks the caller to sort from the head's button", () => {
  const onSort = vi.fn();
  const render = (sort: TableSort | null) =>
    renderToStaticMarkup(
      <Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} empty="-" sort={sort} onSort={onSort} />,
    );
  expect(render(null)).toContain('aria-sort="none"');
  expect(render({ key: "value", dir: "asc" })).toContain('aria-sort="ascending"');
  expect(render({ key: "value", dir: "desc" })).toContain('aria-sort="descending"');
  // Only the sortable column has a button or an aria-sort.
  expect(render(null).match(/aria-sort/g)).toHaveLength(1);
  expect(render(null).match(/<button/g)).toHaveLength(1);

  const h = mount(<Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} empty="-" sort={null} onSort={onSort} />);
  act(() => h.querySelector<HTMLButtonElement>("th button")!.click());
  expect(onSort).toHaveBeenCalledWith("value");
});
