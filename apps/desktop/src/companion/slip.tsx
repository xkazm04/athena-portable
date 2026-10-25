/**
 * A decision rising (Bell's slip, athena-mini-window): what will happen to whom in plain words on
 * the front, every parameter, the page capture and what changed since the person trusted the app
 * on the back ("Read it first"), and one beat when it is signed. Nothing runs until the person signs;
 * the buttons answer, the gate decides (README section 3.3).
 */
import { useEffect, useState, type ReactNode } from "react";

import type { ContractDrift } from "@/lib/contract";
import type { ConnectorLine } from "@/modules/connectors/model";

import { readCapture, type CaptureRead } from "./capture";
import { DetailView, RawRecord, fadeOnScroll } from "./detail";
import { Icon, Sketch } from "./icons";
import type { CardCapture, CardView, CompanionModel, SheetView } from "./model";
import type { Standing } from "./translate/decision";

type Actions = CompanionModel["actions"];

/** The answer is on its way for this card, by this choice. */
/** The tab a card was proposed on reloaded, moved or closed (ADR 0103): it can no longer run there. */
const deadOf = ({ bound }: CardView) => bound && (bound.moved || !bound.open);

function sendingOf(model: CompanionModel, card: CardView) {
  return (kind: "approve" | "decline") => card.sending && (model.decision === null || model.decision.kind === kind);
}

/** The capture the daemon filed with the card, read back from the store (ADR 0066), kept with its id. */
function ShotFigure({ id }: { id: string }) {
  const [read, setRead] = useState<{ id: string; read: CaptureRead } | null>(null);
  useEffect(() => {
    let current = true;
    void readCapture(id).then((found) => current && setRead({ id, read: found }));
    return () => {
      current = false;
    };
  }, [id]);
  return <CaptureShown id={id} read={read?.id === id ? read.read : null} />;
}

/** The figure for one read: the picture, or the sentence that says why there is none. */
export function CaptureShown({ id, read }: { id: string; read: CaptureRead | null }) {
  if (read === null) return <p className="sl-nocap">Reading the capture…</p>;
  if (read.src === null) return <p className="sl-nocap">{`Capture ${id}: ${read.problem}.`}</p>;
  return (
    <figure className="sl-thumb sl-shot">
      <img src={read.src} alt="The page as it was when this was proposed" />
      <figcaption>{`page capture ${id}`}</figcaption>
    </figure>
  );
}

function Capture({ capture }: { capture: CardCapture }) {
  if (capture.kind === "shot") return <ShotFigure id={capture.id} />;
  if (capture.kind === "sketch") {
    return (
      <figure className="sl-thumb">
        <Sketch />
        <figcaption>page capture, stylised</figcaption>
      </figure>
    );
  }
  return <p className="sl-nocap">{capture.why ? `No capture was taken: ${capture.why}.` : "No capture was taken for this request."}</p>;
}

/** A page tool whose contract changed since the user trusted it (ADR 0100): then beside now. */
function ContractChange({ drift }: { drift: ContractDrift }) {
  return (
    <div className="sl-drift" data-drift={drift.tool}>
      <p className="sl-claim">
        {drift.before ? "This tool changed since you trusted this app." : "This tool appeared after you trusted this app."}
      </p>
      <dl className="d-facts">
        {drift.before ? (
          <div className="d-fact">
            <dt>before</dt>
            <dd>{drift.before.description}</dd>
          </div>
        ) : null}
        {drift.before && drift.before.schema !== drift.after.schema ? (
          <div className="d-fact">
            <dt>inputs before</dt>
            <dd>{drift.before.schema}</dd>
          </div>
        ) : null}
        <div className="d-fact">
          <dt>{drift.before ? "now" : "says"}</dt>
          <dd>{drift.after.description}</dd>
        </div>
        {!drift.before || drift.before.schema !== drift.after.schema ? (
          <div className="d-fact">
            <dt>inputs now</dt>
            <dd>{drift.after.schema}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** Who a connector card acts as, and the one cause the record says will stop it (ADR 0116). */
function ConnectorStanding({ line, openMain }: { line: ConnectorLine; openMain: () => void }) {
  return (
    <>
      <p className="sl-line" data-connector>
        {line.line}
      </p>
      {line.warning ? (
        <p className="sl-notice" data-connector-warning role="note">
          <Icon name="warn" className="warn" />
          <span>{line.warning.text}</span>
          <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="open-main" aria-label="Open Main, where Accounts can put this right" onClick={openMain}>
            Open Main
          </button>
        </p>
      ) : null}
    </>
  );
}

/** Where a card runs: the app and whose tool, the account, the tab it was proposed on. */
export function Where({ card, actions }: { card: CardView; actions: Actions }) {
  return (
    <>
      <p className="sl-line" data-tier={card.tier}>
        {card.where}
      </p>
      {card.connector ? <ConnectorStanding line={card.connector} openMain={actions.openMain} /> : null}
      {card.bound ? (
        <p className={card.bound.moved || !card.bound.open ? "sl-notice" : "sl-line"} data-bound-tab={card.bound.tabId} data-moved={card.bound.moved ? "1" : undefined}>
          <span>
            Proposed on {card.bound.label}
            {card.bound.moved ? " (it has reloaded since)" : ""}
          </span>
          {card.bound.open && !card.bound.focused ? (
            <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="go-to-tab" onClick={() => actions.goToTab(card.bound!.tabId)}>
              Go to that tab
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** Everything the card will run, uncut, and what the page and the gate know about it. */
export function CardFull({ card, actions, capture = true }: { card: CardView; actions: Actions; capture?: boolean }) {
  return (
    <>
      {card.words.letter ? <DetailView detail={{ kind: "letter", ...card.words.letter }} /> : null}
      <Where card={card} actions={actions} />
      <dl className="d-facts sl-params">
        {card.params.map((p) => (
          <div key={p.key} className="d-fact">
            <dt>{p.key}</dt>
            <dd>{p.value}</dd>
          </div>
        ))}
      </dl>
      {card.claimed ? <p className="sl-claim">The element names are the page&apos;s own labels.</p> : null}
      {card.targetNote ? <p className="sl-claim">{card.targetNote}</p> : null}
      {card.drift ? <ContractChange drift={card.drift} /> : null}
      {capture ? <Capture capture={card.capture} /> : null}
      <RawRecord raw={() => `${card.action}\n${JSON.stringify(Object.fromEntries(card.params.map((p) => [p.key, p.value])), null, 2)}`} />
    </>
  );
}

/**
 * What the turn already read about the card's target (ADR 0199): its notes as a notice the person
 * reads before signing, and one quiet line saying how old that reading is. Nothing when it read none.
 */
export function StandingNote({ standing }: { standing: Standing | null }) {
  if (!standing) return null;
  const asOf = standing.readBy ? `As she read it${standing.readAt ? ` at ${standing.readAt}` : ""}: ${standing.readBy}` : "";
  const line = [...standing.facts.map((f) => `${f.k} ${f.v}`), asOf].filter(Boolean).join(" · ");
  if (!standing.notes.length) {
    return line ? (
      <p className="sl-line" data-standing-asof>
        {line}
      </p>
    ) : null;
  }
  return (
    <div className="sl-notice" data-standing-note role="note">
      <Icon name="warn" className="warn" />
      {standing.notes.map((n) => (
        <span key={n.k}>
          <b>{n.k}:</b> {n.v}
        </span>
      ))}
      {line ? <span className="sl-claim">{line}</span> : null}
    </div>
  );
}

/** Approve and Decline, with their keys. `label` is what the approve press runs (a sheet counts rows). */
export function Sign({ model, card, label, decline, disabled, small }: {
  model: CompanionModel;
  card: CardView;
  label: string;
  decline: string;
  disabled: boolean;
  small?: boolean;
}) {
  const { actions, decision } = model;
  const sending = sendingOf(model, card);
  const off = decision !== null || card.sending;
  const sm = small ? " aw-btn-sm" : "";
  // Its tab moved or closed (ADR 0103): it cannot run, so the primary press asks her again instead.
  return (
    <>
      {deadOf(card) ? (
        <button type="button" className={`aw-btn aw-btn-approve${sm}`} data-act="reask" disabled={off} onClick={() => actions.reask(card.id)}>
          Ask again here
        </button>
      ) : (
        <button type="button" className={`aw-btn aw-btn-approve${sm}`} data-act="approve" aria-keyshortcuts="A" aria-busy={sending("approve") || undefined} disabled={off || disabled} onClick={() => actions.approve("click")}>
          <span className="fill" aria-hidden="true" />
          <span className="lbl">{sending("approve") ? "Signing…" : label}</span>
          {sending("approve") ? null : <kbd>A</kbd>}
        </button>
      )}
      <button type="button" className={`aw-btn aw-btn-decl${sm}`} data-act="decline" aria-keyshortcuts="D" aria-busy={sending("decline") || undefined} disabled={off} onClick={() => actions.decline("click")}>
        {sending("decline") ? "Declining…" : decline}
        {sending("decline") ? null : <kbd>D</kbd>}
      </button>
    </>
  );
}

/** Hold and say "approve" or "decline" (ADR 0020): the slip's voice, a word and not an icon alone. */
function Speak({ model, off }: { model: CompanionModel; off: boolean }) {
  const { actions } = model;
  return (
    <button
      type="button"
      className="sl-voice"
      data-act="mic"
      aria-label="Speak: hold and say approve or decline"
      title={model.micAvailable ? "Hold and say approve or decline" : "Voice is not available on this computer yet"}
      disabled={!model.micAvailable || off}
      onPointerDown={(e) => {
        actions.micDown();
        const up = () => {
          document.removeEventListener("pointerup", up);
          document.removeEventListener("pointercancel", up);
          actions.micUp();
        };
        document.addEventListener("pointerup", up);
        document.addEventListener("pointercancel", up);
        e.preventDefault();
      }}
    >
      <Icon name="mic" />
      <span>{model.listening ? model.heard || "listening…" : "Speak"}</span>
    </button>
  );
}

function Face({ cls, head, body, actions }: { cls: string; head: ReactNode; body: ReactNode; actions: ReactNode }) {
  return (
    <div className={`sl-face ${cls}`}>
      <div className="sl-head">{head}</div>
      <div className="sl-body fades" onScroll={fadeOnScroll}>
        {body}
      </div>
      <div className="sl-actions">{actions}</div>
    </div>
  );
}

/** The slip form: one decision (or one sheet of them) waiting on the person. */
export function Slip({ model }: { model: CompanionModel }) {
  const card = model.cards[0];
  const [flipped, setFlipped] = useState<string | null>(null);
  if (!card) return <p className="sl-effect sl-none">Nothing is waiting on you.</p>;
  const { actions, decision } = model;
  const n = model.cards.length;
  const sheet = model.sheet && model.sheet.rows[0]?.id === card.id ? model.sheet : null;
  const off = decision !== null || card.sending;
  const back = flipped === card.id;
  const eyebrow = (
    <span className="sl-count">
      <i className={model.attn ? "on" : ""} />
      {`Waiting on you${n > 1 ? ` · ${n} decisions` : ""}`}
    </span>
  );
  const stamped = decision !== null && !decision.sending;
  return (
    <div className="slip" data-stack={n > 1 ? "many" : "1"}>
      <div className="sheets" aria-hidden="true">
        <i />
        <i />
      </div>
      <article
        className={`sl-card decision${back ? " flipped" : ""}`}
        aria-label={`A decision is waiting on you: ${sheet ? `${sheet.rows.length} requests in ${sheet.app}` : card.words.title}`}
        data-card={sheet ? undefined : card.id}
        data-sheet={sheet ? sheet.key : undefined}
        data-sending={card.sending ? "1" : undefined}
        data-decision={stamped ? (decision.kind === "approve" ? "approved" : "declined") : undefined}
      >
        <Face
          cls="sl-front"
          head={
            <>
              <div className="sl-toprow">
                {eyebrow}
                <Speak model={model} off={off} />
              </div>
              <h2 className="sl-title display">{sheet ? `${sheet.rows.length} requests in ${sheet.app}` : card.words.title}</h2>
            </>
          }
          body={sheet ? <SheetRows model={model} sheet={sheet} off={off} /> : <Front card={card} actions={actions} mic={model.micAvailable} />}
          actions={
            <>
              <Sign model={model} card={card} label={sheet ? sheet.approve : "Approve"} decline={sheet ? "Decline all" : "Decline"} disabled={sheet ? sheet.ticked === 0 : false} />
              <span className="sl-sp" />
              {sheet ? null : (
                <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="read" onClick={() => setFlipped(card.id)}>
                  Read it first
                </button>
              )}
              <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="later" title="Put away without answering (Esc)" onClick={actions.esc}>
                Later
              </button>
            </>
          }
        />
        {sheet ? null : (
          <div className="sl-face sl-back" aria-hidden={!back}>
            <div className="sl-back-head">
              <span className="eyebrow human">{card.words.letter ? "The letter that will be sent" : "What this will do"}</span>
              <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="front" onClick={() => setFlipped(null)}>
                Back to the decision
              </button>
            </div>
            <div className="sl-back-body fades" onScroll={fadeOnScroll}>
              <CardFull card={card} actions={actions} />
            </div>
          </div>
        )}
        <div className="sl-done" aria-hidden={!stamped}>
          <h3>{decision?.kind === "decline" ? "Declined." : "Signed."}</h3>
          <p>{decision?.kind === "decline" ? "Nothing was changed." : "It runs now, and only this once."}</p>
        </div>
      </article>
    </div>
  );
}

/** The front of one card: the effect, the reason, the facts, and anything that would stop it. */
function Front({ card, actions, mic }: { card: CardView; actions: Actions; mic: boolean }) {
  const facts = card.words.facts.filter((f) => f.k !== "To" && f.k !== "Subject").slice(0, 3);
  if (card.expires) facts.push({ k: "Valid until", v: card.expires });
  return (
    <>
      <p className="sl-effect">{card.words.effect}</p>
      <p className="sl-why">Why: {card.rationale}</p>
      <StandingNote standing={card.words.standing} />
      {facts.length ? (
        <div className="facts-inline">
          {facts.map((f) => (
            <span key={f.k}>
              {f.k} <b>{f.v}</b>
            </span>
          ))}
        </div>
      ) : null}
      <p className="sl-sign-note">{mic ? "Nothing runs until you sign. Or say “approve”." : "Nothing runs until you sign."}</p>
      {card.connector?.warning || deadOf(card) ? <Where card={card} actions={actions} /> : null}
      {card.drift ? (
        <p className="sl-notice" role="note">
          <Icon name="warn" className="warn" />
          <span>This tool changed since you trusted this app. Read it first.</span>
        </p>
      ) : null}
      {card.refusal ? (
        <p className="sl-notice bad" data-refusal role="alert">
          <Icon name="warn" className="warn" />
          <span>{card.refusal}</span>
        </p>
      ) : null}
    </>
  );
}

/** A turn's cards as one sheet (ADR 0104): every row whole with its tick, in the order they run. */
export function SheetRows({ model, sheet, off }: { model: CompanionModel; sheet: SheetView; off: boolean }) {
  const { actions } = model;
  return (
    <div className="sheet" data-rows={String(sheet.rows.length)}>
      <p className="sl-why">One turn asked for these, in this order. They run top to bottom and stop at the first one that fails. An unticked row is declined.</p>
      <ol className="sh-rows">
        {sheet.rows.map((row, at) => (
          <li key={row.id} className="sh-row" data-card={row.id} data-ticked={row.ticked ? "1" : "0"} data-tier={row.tier}>
            {row.group ? (
              <p className="sh-group" data-group>
                {row.group}
              </p>
            ) : null}
            <label className="sh-tick">
              <input type="checkbox" checked={row.ticked} disabled={off} onChange={() => actions.tick(row.id)} aria-label={`Row ${at + 1}: ${row.words.title}`} />
              <span className="sh-n">{at + 1}</span>
              <span className="sh-title">{row.words.title}</span>
            </label>
            {row.rationale ? <p className="sl-why">{row.rationale}</p> : null}
            <StandingNote standing={row.words.standing} />
            <details className="sh-more">
              <summary>Every detail</summary>
              <CardFull card={row} actions={actions} capture={false} />
            </details>
            {row.refusal ? (
              <p className="sl-notice bad" data-refusal>
                {row.refusal}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {sheet.rows.some((r) => r.claimed) ? <p className="sl-claim">The element names are the page&apos;s own labels.</p> : null}
      {sheet.footer ? (
        <p className="sh-footer" data-footer>
          {sheet.footer}
        </p>
      ) : null}
      {sheet.ran ? (
        <p className="sl-notice bad" data-ran>
          <Icon name="warn" className="warn" />
          <span>{sheet.ran}</span>
        </p>
      ) : null}
    </div>
  );
}
