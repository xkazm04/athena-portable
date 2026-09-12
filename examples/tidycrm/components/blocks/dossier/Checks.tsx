"use client";

/**
 * The four checks, the competing spellings, and the rows that failed them.
 *
 * Every check is printed whether it passed or not, because a check that only
 * appears when it fails cannot tell a reader the difference between "clean" and
 * "never looked at". A passing one states the clause it satisfied.
 */
import {
  CLEAR_CLAUSE,
  DEVIATION_KINDS,
  DEVIATION_LABEL,
  type Deviation,
  type DeviationKind,
  type BkTable,
} from "../model";
import { Band, fmtDate } from "./parts";

export function DossierChecks({
  table,
  failed,
}: {
  table: BkTable;
  failed: Map<DeviationKind, Deviation>;
}) {
  return (
      <div className="bk-dossier-main">
        <Band label="The four checks on this block" />
        <div className="bk-checks">
          {DEVIATION_KINDS.map((kind) => {
            const hit = failed.get(kind);
            return (
              <div className="bk-check" key={kind} data-kind={kind} data-failed={Boolean(hit)}>
                <span className="bk-check-mark" aria-hidden>
                  {hit ? "✗" : "✓"}
                </span>
                <span className="bk-check-text">{hit ? hit.clause : CLEAR_CLAUSE[kind]}</span>
                <span className="bk-check-count">
                  {hit ? `${DEVIATION_LABEL[kind]} ${hit.count}` : "checked"}
                </span>
              </div>
            );
          })}
        </div>
        {table.spellings.length > 1 ? (
          <>
            <Band
              label="Competing company spellings"
              note="consensus first; the rest are the deviation"
            />
            <div className="bk-spellings">
              {table.spellings.map((spelling, index) => (
                <span key={spelling.company} className="bk-spelling" data-differs={index > 0}>
                  {spelling.company}
                  <b>×{spelling.n}</b>
                </span>
              ))}
            </div>
          </>
        ) : null}
        <Band label="Example rows" note="the deviant ones first, offending value marked" />
        <div className="bk-table-wrap">
          <table className="bk-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Company</th>
                <th scope="col">Last activity</th>
                <th scope="col">Changed</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id}>
                  <td data-bad={row.inOpenPair}>{row.name}</td>
                  <td>{row.email}</td>
                  <td data-bad={!row.phoneOk}>{row.phone}</td>
                  <td data-bad={row.conflict}>{row.company}</td>
                  <td data-fig="true" data-bad={row.isStale && !row.staleFlagged}>
                    {fmtDate(row.lastActivityAt)}
                  </td>
                  <td data-fig="true">{row.changed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.rowsHidden > 0 ? (
          <p className="bk-truncated">
            (showing {table.rows.length} of {table.records})
          </p>
        ) : null}
      </div>
  );
}
