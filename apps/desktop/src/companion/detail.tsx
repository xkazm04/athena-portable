/**
 * The content one level below a message (Bell's `renderDetail`, athena-mini-window): a table, a
 * comparison, a letter, facts or a quote, each built from what the translator read out of the
 * tool's answer. The raw text is reachable only through {@link RawRecord}, the last resort.
 */
import { useState, type UIEvent } from "react";

/** A scroller whose top row has slid under its header fades that row (`.fades[data-scrolled]`). */
export function fadeOnScroll(e: UIEvent<HTMLElement>) {
  e.currentTarget.dataset.scrolled = e.currentTarget.scrollTop > 2 ? "1" : "0";
}

import type { Detail } from "./translate";

export function DetailView({ detail }: { detail: Detail }) {
  switch (detail.kind) {
    case "table":
      return (
        <div className="d-wrap">
          <table className="d-table">
            <thead>
              <tr>
                {detail.cols.map((c) => (
                  <th key={c.key} scope="col" className={c.align === "r" ? "r" : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.flatMap((r, at) => [
                <tr key={`r${at}`}>
                  {r.cells.map((cell, i) => {
                    const col = detail.cols[i];
                    const cls = [col?.align === "r" ? "r" : "", col?.num ? "num" : ""].filter(Boolean).join(" ");
                    return (
                      <td key={col?.key ?? i} className={cls || undefined} title={i === 0 && r.hint ? r.hint : undefined}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>,
                r.note ? (
                  <tr key={`n${at}`} className="d-note">
                    <td colSpan={detail.cols.length}>
                      <b>{r.note.k}: </b>
                      {r.note.v}
                    </td>
                  </tr>
                ) : null,
              ])}
            </tbody>
          </table>
        </div>
      );
    case "compare":
      return (
        <div className="d-wrap">
          <table className="d-table d-compare">
            <thead>
              <tr>
                <th scope="col" />
                {detail.cols.map((c) => (
                  <th key={c} scope="col" className="r">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {r.values.map((v, i) => (
                    <td key={i} className="r num">
                      {v}
                      {i === 0 && r.delta !== 0 && Number.isFinite(r.delta) ? (
                        <small className={r.delta > 0 ? "up" : "down"}>
                          {(r.delta > 0 ? " +" : " -") + Math.round(Math.abs(r.delta) * 100)}%
                        </small>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "letter":
      return (
        <div className="d-letter">
          <div className="d-l-head">
            <div>
              <span>To</span>
              {detail.to}
            </div>
            <div>
              <span>Subject</span>
              {detail.subject || "(none)"}
            </div>
          </div>
          <div className="d-l-body">
            {detail.body.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p.replace(/\n/g, " ")}</p>
            ))}
          </div>
          {detail.cut ? <div className="d-l-cut">The saved preview ends here; the full draft is in the app.</div> : null}
        </div>
      );
    case "facts":
      return (
        <dl className="d-facts">
          {detail.rows.map((r, i) => (
            <div key={`${r.k}${i}`} className="d-fact">
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>
      );
    case "quote":
      return (
        <figure className="d-quote">
          <blockquote>{detail.text}</blockquote>
          {detail.meta ? <figcaption>{detail.meta}</figcaption> : null}
        </figure>
      );
    default:
      return null;
  }
}

/** The explicit last resort: the raw text behind a toggle, laid out, never shown unasked. */
export function RawRecord({ raw, label = "Technical record" }: { raw: () => string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="d-rawbox">
      <button type="button" className="d-rawbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Hide technical record" : label}</span>
      </button>
      {open ? <pre className="d-raw">{raw()}</pre> : null}
    </div>
  );
}
