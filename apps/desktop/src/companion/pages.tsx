/**
 * The levels below the conversation (Bell's depth page, athena-mini-window): a step opened, a
 * decision read before it is signed, and the two pages the ledger keeps beside the conversation -
 * the Record of what ran and the apps she may act on. Each slides in over the conversation with a
 * way back ("Rise to the conversation", Esc).
 */
import { useEffect, useRef, type ReactNode } from "react";

import { DetailView, RawRecord, fadeOnScroll } from "./detail";
import { Icon } from "./icons";
import { showingOf, type CompanionModel, type RecordRow } from "./model";
import { CardFull } from "./slip";
import { prettyRaw } from "./translate";

/** One level down: the way back, where it is, and its body. Closed, it is inert and off screen. */
function Level({ open, crumb, onRise, children, label }: { open: boolean; crumb: string; onRise: () => void; children: ReactNode; label: string }) {
  const rise = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) rise.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <section className={`aw-depth${open ? " open" : ""}`} aria-hidden={!open} inert={!open} aria-label={label}>
      <div className="depth-top">
        <button ref={rise} type="button" className="rise" data-act="rise" onClick={onRise}>
          <Icon name="back" />
          Rise to the conversation
          <kbd>Esc</kbd>
        </button>
        <div className="depth-crumb">{crumb}</div>
      </div>
      <div className="depth-body fades" tabIndex={0} role="region" aria-label={label} onScroll={fadeOnScroll}>
        {open ? children : null}
      </div>
    </section>
  );
}

/** A step or a waiting decision, opened one level below the conversation. */
export function Depth({ model }: { model: CompanionModel }) {
  const { depth, actions, talk } = model;
  const card = depth?.startsWith("decision:") ? model.cards.find((c) => c.id === depth.slice(9)) : undefined;
  const msg = depth && !card ? talk.messages.find((m) => m.id === depth) : undefined;
  const open = model.tab === "talk" && (!!card || !!msg);
  const title = card ? card.words.title : (msg?.title ?? "");
  const where = [...talk.messages].reverse().find((m) => m.role === "user")?.title ?? "Athena";
  return (
    <Level open={open} crumb={`Athena / ${where} / ${title}`} onRise={actions.rise} label={title || "Detail"}>
      {card ? (
        <>
          <div className="depth-meta">
            <span className="tag human">Waiting on you</span>
          </div>
          <h2>{card.words.title}</h2>
          <p className="lead">{card.words.effect}</p>
          <CardFull card={card} actions={actions} />
        </>
      ) : msg ? (
        <>
          <div className="depth-meta">
            {msg.where ? <span className="tag">{msg.where}</span> : null}
            {msg.time ? <span className="tag">{msg.time}</span> : null}
            {msg.recovered ? <span className="tag ok">She tried again and it worked</span> : null}
          </div>
          <h2>{msg.title}</h2>
          {msg.sub ? <p className="lead">{msg.sub}</p> : null}
          <DetailView detail={msg.detail} />
          <RawRecord raw={() => prettyRaw(msg.raw)} />
        </>
      ) : null}
    </Level>
  );
}

function RecordLine({ row }: { row: RecordRow }) {
  return (
    <li className="rec-row" data-result={row.result}>
      <span className="rec-t">{row.title}</span>
      <span className={`tag rec-r rec-${row.result}`}>{row.result}</span>
      <span className="rec-meta">
        <span>{row.app}</span>
        {row.cls ? <span className="rec-cls">{row.cls}</span> : null}
        <code>{row.tool}</code>
        {row.clock ? <span>{row.clock}</span> : null}
      </span>
    </li>
  );
}

function Record({ model }: { model: CompanionModel }) {
  const { session, earlier, ledger, header } = model.record;
  return (
    <>
      <h2>The record</h2>
      <p className="lead" data-complete={model.record.complete ? "1" : "0"}>
        {header}
      </p>
      <h3 className="eyebrow">This window</h3>
      {session.length === 0 ? (
        <p className="lg-note">Nothing has run in this window yet.</p>
      ) : (
        <ol className="rec" aria-label="This window">
          {session.map((r) => (
            <RecordLine key={`${r.id}/${r.result}/${r.at}`} row={r} />
          ))}
        </ol>
      )}
      <p className="lg-note">{showingOf(session.length, session.length)}</p>
      <h3 className="eyebrow">Earlier (kept on this computer)</h3>
      {earlier === null ? (
        <p className="lg-note">Not read yet.</p>
      ) : earlier.problem ? (
        <p className="lg-note" role="alert">
          Could not be read: {earlier.problem}
        </p>
      ) : (
        <>
          {earlier.rows.length === 0 ? (
            <p className="lg-note">Nothing was kept from earlier windows.</p>
          ) : (
            <ol className="rec" aria-label="Earlier">
              {earlier.rows.map((r) => (
                <RecordLine key={`${r.id}/${r.result}/${r.at}`} row={r} />
              ))}
            </ol>
          )}
          <p className="lg-note">{earlier.footer}</p>
        </>
      )}
      <h3 className="eyebrow">Model calls</h3>
      {ledger === null ? (
        <p className="lg-note">Athena has not answered yet.</p>
      ) : ledger.problem ? (
        <p className="lg-note" role="alert">
          Could not be read: {ledger.problem}
        </p>
      ) : ledger.rows.length === 0 ? (
        <p className="lg-note">No model call has been made. {showingOf(0, 0)}</p>
      ) : (
        <>
          <ol className="rec">
            {ledger.rows.map((r) => (
              <li key={r.id} className="rec-row" data-result={r.isError ? "refused" : "ok"}>
                <span className="rec-t">{r.isError ? r.reason || "error" : `${r.rounds} round${r.rounds === 1 ? "" : "s"}, ${r.cost}`}</span>
                <span className="rec-meta">
                  <span>{r.model}</span>
                  <span>{r.clock}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="lg-note">{ledger.footer || showingOf(ledger.rows.length, ledger.total)}</p>
        </>
      )}
    </>
  );
}

function Origins({ model }: { model: CompanionModel }) {
  const { origins, actions } = model;
  return (
    <>
      <h2>The apps she may act on</h2>
      <p className="lead">{origins.host ? `What ${origins.host} offers her, and who she may act for.` : "No page is open."}</p>
      <h3 className="eyebrow">This page offers</h3>
      {origins.pageProblem ? (
        <p className="lg-note" role="alert">
          This page could not be read: {origins.pageProblem}
          {origins.offers.length > 0 ? ". Only her own hands are listed." : ""}
        </p>
      ) : origins.pageSilent ? (
        <p className="lg-note">This page publishes no tools of its own.</p>
      ) : null}
      {origins.offers.length === 0 ? (
        origins.pageProblem || origins.pageSilent ? null : <p className="lg-note">Nothing has been read from this page yet.</p>
      ) : (
        <ul className="offers">
          {origins.offers.map((o) => (
            <li key={o.name}>
              <b>{o.name.split(".").slice(-1)[0]}</b>
              <span className={`tag cls-${o.cls.toLowerCase()}`}>{o.cls}</span>
              {o.tier === 2 ? <span className="tag">hand, tier 2</span> : null}
              <span className="offer-d">{o.description || o.name}</span>
            </li>
          ))}
        </ul>
      )}
      {origins.offersFooter ? <p className="lg-note">{origins.offersFooter}</p> : null}
      <h3 className="eyebrow">Apps she has seen</h3>
      {origins.known.length === 0 ? (
        <p className="lg-note">None yet. The first time she sees a page, what she wants to do there waits for your answer.</p>
      ) : (
        <ul className="offers">
          {origins.known.map((k) => {
            const host = k.origin.replace(/^https?:\/\//, "");
            return (
              <li key={k.origin}>
                <b>{host}</b>
                <span className="offer-d">
                  {k.enabled ? "enabled" : "off"}
                  {k.overrides ? `, ${k.overrides} pinned` : ""}
                </span>
                <button type="button" className="aw-btn aw-btn-sm" aria-label={`${k.enabled ? "Disable" : "Enable"} ${host}`} onClick={() => actions.setOrigin(k.origin, !k.enabled)}>
                  {k.enabled ? "Disable" : "Enable"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The Record and the apps, as pages beside the conversation. */
export function Pages({ model }: { model: CompanionModel }) {
  const rise = () => model.actions.tab("talk");
  return (
    <>
      <Level open={model.tab === "record"} crumb="Athena / The record" onRise={rise} label="Record">
        <Record model={model} />
      </Level>
      <Level open={model.tab === "origins"} crumb="Athena / The apps she may act on" onRise={rise} label="Origins">
        <Origins model={model} />
      </Level>
    </>
  );
}
