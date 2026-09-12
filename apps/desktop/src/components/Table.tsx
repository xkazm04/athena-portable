/**
 * @catalog The app's one table: a columns array with a render per column and a required `empty`.
 *
 * House style §3.2, the first of the three density wins: six of the first build's eight surfaces
 * were designed inside a 380px column and stacked their record lists. At full width a table shows
 * three to five times as many rows in the same height, and its figures align, which stacked rows
 * cannot do.
 *
 * `empty` is required rather than optional because "nothing here" is an answer a reader needs,
 * and every table that made it optional shipped a blank rectangle.
 */
import type { ReactNode } from "react";

export interface Column<Row> {
  key: string;
  head: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
}

export default function Table<Row>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string | number;
  empty: string;
  caption?: string;
}) {
  return (
    <div className="table-scroll">
      <table className="table">
        {caption ? <caption className="typo-caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "is-right" : undefined} scope="col">
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="table__empty typo-caption" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "is-right" : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
