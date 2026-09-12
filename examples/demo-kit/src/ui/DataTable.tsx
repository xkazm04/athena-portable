"use client";

/**
 * `DataTable` - the scaffold's list view: sortable columns and row selection.
 *
 * Selection is lifted out on purpose, so the app that renders this can publish it as a readable
 * and an agent can act on "these three" without inventing its own protocol. The only such
 * registration in this tree is `template/components/RecordsTable.tsx`.
 *
 * Real consumer set: `examples/demo-kit/template/` only - none of the four shipped apps imports
 * this. Changing the sort comparator or the select-all semantics changes the scaffold, not them.
 */
import { useMemo, useState, type ReactNode } from "react";
import { clsx } from "clsx";

export interface Column<T> {
  /** Stable key; also the sort key reported to `onSortChange`. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Value used for sorting. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  align?: "start" | "end";
  width?: string;
}

export type SortDir = "asc" | "desc";

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowId: (row: T) => string;
  /** Controlled selection. Pass both to let the app publish it as the `selection` readable. */
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowClick?: (row: T) => void;
  /** Highlighted row (usually the one open in the detail pane). */
  activeId?: string;
  empty?: ReactNode;
  caption?: string;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowId,
  selected,
  onSelectionChange,
  onRowClick,
  activeId,
  empty,
  caption,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const selectable = Boolean(onSelectionChange);
  const selectedSet = useMemo(() => new Set(selected ?? []), [selected]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * factor;
    });
  }, [rows, columns, sort]);

  const toggleSort = (key: string) => {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  };

  const allIds = sorted.map(rowId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={clsx("dk-table-wrap", className)}>
      <table className="dk-table">
        {caption ? <caption className="dk-table-caption">{caption}</caption> : null}
        <thead>
          <tr>
            {selectable ? (
              <th className="dk-table-check">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={() => onSelectionChange?.(allSelected ? [] : allIds)}
                />
              </th>
            ) : null}
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                data-align={col.align ?? "start"}
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    className="dk-table-sort"
                    onClick={() => toggleSort(col.key)}
                    aria-label={`Sort by ${col.key}`}
                  >
                    {col.header}
                    <span aria-hidden="true">
                      {sort?.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : " ↕"}
                    </span>
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const id = rowId(row);
            return (
              <tr
                key={id}
                className={clsx(
                  "dk-table-row",
                  selectedSet.has(id) && "dk-table-row-selected",
                  activeId === id && "dk-table-row-active",
                  onRowClick && "dk-table-row-clickable",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selectable ? (
                  <td className="dk-table-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${id}`}
                      checked={selectedSet.has(id)}
                      onChange={() => toggleRow(id)}
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td key={col.key} data-align={col.align ?? "start"}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
