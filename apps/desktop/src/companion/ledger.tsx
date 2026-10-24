/**
 * The ledger as a descent (Bell, athena-mini-window): one conversation on a rail under the seal,
 * every step a plain sentence that opens one level down, the waiting decision riding at its foot,
 * and the Record and the apps she may act on as pages beside it (`pages.tsx`).
 */
import { useEffect, useRef, type FormEvent } from "react";

import { fadeOnScroll } from "./detail";
import { Icon } from "./icons";
import type { CompanionModel, ProjectView } from "./model";
import { Depth, Pages } from "./pages";
import { SheetRows, Sign } from "./slip";
import type { PlainMessage } from "./translate";

export function Ledger({ model }: { model: CompanionModel }) {
  const { actions, talk } = model;
  const title = [...talk.messages].reverse().find((m) => m.role === "user")?.title;
  return (
    <div className="lg">
      <header className="lg-head">
        <div className="crumbs">
          <span className="eyebrow">{`Athena${talk.host ? ` / ${talk.host}` : ""}`}</span>
        </div>
        <h2 className="lg-title">{title ?? "Athena"}</h2>
        <span className="lg-tools">
          <button type="button" className="iconbtn" data-act="record" aria-label="The record of what ran" title="The record of what ran" onClick={() => actions.tab("record")}>
            <Icon name="record" />
          </button>
          <button type="button" className="iconbtn" data-act="origins" aria-label="The apps she may act on" title="The apps she may act on" onClick={() => actions.tab("origins")}>
            <Icon name="apps" />
          </button>
          <button
            type="button"
            className={`iconbtn${model.pinned ? " on" : ""}`}
            data-act="pin"
            aria-pressed={model.pinned}
            aria-label="Keep Athena on top of other windows"
            title="Keep Athena on top of other windows"
            onClick={actions.pin}
          >
            <Icon name="pin" />
          </button>
          <button type="button" className="iconbtn" data-act="collapse" aria-label="Fold back into the seal (Escape)" title="Fold back into the seal (Escape)" onClick={actions.esc}>
            <Icon name="up" />
          </button>
        </span>
      </header>
      <Talk model={model} />
      <Compose model={model} />
      <Depth model={model} />
      <Pages model={model} />
    </div>
  );
}

/** A handed-over playbook before the first turn: her plan, the tabs she will ask for, her stops. */
function Plan({ project }: { project: ProjectView }) {
  return (
    <div className="lg-plan" aria-label={`The plan for ${project.title}`}>
      <p className="eyebrow">The plan</p>
      <h3 className="display">{project.title}</h3>
      <ol className="lg-plan__steps">
        {project.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {project.portals.length ? (
        <p className="lg-plan__row">
          <span className="lg-plan__label">Tabs she will ask for</span>
          {project.portals.map((p) => (
            <span key={p} className="tag">
              {p}
            </span>
          ))}
        </p>
      ) : null}
      {project.stops.length ? (
        <p className="lg-plan__row">
          <span className="lg-plan__label">She stops for your signature to</span>
          {project.stops.map((g) => (
            <span key={g} className="tag human">
              {g}
            </span>
          ))}
        </p>
      ) : null}
      <p className="lg-plan__note">The command is in the box below. Send it when you are on the first tab.</p>
    </div>
  );
}

function Empty({ model }: { model: CompanionModel }) {
  const { talk, actions } = model;
  return (
    <div className="aw-empty">
      <h3 className="display">Nothing yet.</h3>
      <p>
        {talk.host ? `Ask about ${talk.host}.` : "Open a page, then ask about it."} Nothing she does there runs without
        your signature.
      </p>
      <div className="chips">
        {talk.suggestions.map((s) => (
          <button key={s} type="button" className="chip" disabled={!!talk.blocked} onClick={() => actions.send(s)}>
            {s}
          </button>
        ))}
      </div>
      {talk.mainHidden ? (
        <button type="button" className="aw-textbtn" data-act="open-main" onClick={actions.openMain}>
          Main is hidden. Click here or use the tray to open it.
        </button>
      ) : null}
    </div>
  );
}

/** One message on the rail: words for what was said, a row that opens for what was done. */
function Message({ m, onOpen }: { m: PlainMessage; onOpen: (id: string) => void }) {
  if (m.role === "user" || m.role === "her") {
    return (
      <div className={`msg msg-${m.role}`} data-tone={m.tone}>
        <span className="node" />
        <div className="eyebrow msg-who">{m.role === "user" ? "You" : "Athena"}</div>
        <div className="txt">{m.title}</div>
      </div>
    );
  }
  return (
    <div className={`msg msg-${m.role}`} data-tone={m.tone} data-tool={m.tool}>
      <span className="node" />
      <button type="button" className="step" data-tone={m.tone} onClick={() => onOpen(m.id)}>
        <span className="st-title">{m.title}</span>
        {m.sub ? <span className="st-sub">{m.sub}</span> : null}
        {m.where || m.time || m.recovered ? (
          <span className="st-meta">
            {m.where ? <span>{m.where}</span> : null}
            {m.time ? <span>{m.time}</span> : null}
            {m.recovered ? <span className="tag ok">She tried again and it worked</span> : null}
          </span>
        ) : null}
        <Icon name="chevron" className="st-chev" />
      </button>
    </div>
  );
}

/** The decision waiting on the person, at the foot of the descent. */
function Gate({ model }: { model: CompanionModel }) {
  const card = model.cards[0];
  if (!card || model.decision) return null;
  const n = model.cards.length;
  const sheet = model.sheet && model.sheet.rows[0]?.id === card.id ? model.sheet : null;
  return (
    <div className="msg msg-gate">
      <span className="node" />
      <article
        className="gate decision"
        aria-label={`A decision is waiting on you: ${sheet ? `${sheet.rows.length} requests in ${sheet.app}` : card.words.title}`}
        data-card={sheet ? undefined : card.id}
        data-sheet={sheet ? sheet.key : undefined}
        data-sending={card.sending ? "1" : undefined}
      >
        <div className="eyebrow human">{`Waiting on you${n > 1 ? ` · ${n} decisions` : ""}`}</div>
        <h3 className="sl-title display">{sheet ? `${sheet.rows.length} requests in ${sheet.app}` : card.words.title}</h3>
        {sheet ? <SheetRows model={model} sheet={sheet} off={card.sending} /> : <p className="sl-effect">{card.words.effect}</p>}
        {card.refusal ? (
          <p className="sl-notice bad" data-refusal role="alert">
            <Icon name="warn" className="warn" />
            <span>{card.refusal}</span>
          </p>
        ) : null}
        <div className="row">
          <Sign model={model} card={card} label={sheet ? sheet.approve : "Approve"} decline={sheet ? "Decline all" : "Decline"} disabled={sheet ? sheet.ticked === 0 : false} small />
          {sheet ? null : (
            <button type="button" className="aw-btn aw-btn-ghost aw-btn-sm" data-act="read" onClick={() => model.actions.descend(`decision:${card.id}`)}>
              Read it first
            </button>
          )}
          {n > 1 ? <span className="more">{`+ ${n - 1} more after this`}</span> : null}
        </div>
      </article>
    </div>
  );
}

function Talk({ model }: { model: CompanionModel }) {
  const { talk, actions } = model;
  const end = useRef<HTMLDivElement>(null);
  const count = talk.messages.length + model.cards.length;
  useEffect(() => {
    // The newest thing is what she is waiting for; keep it in view as it arrives.
    end.current?.scrollIntoView({ block: "end" });
  }, [count, talk.working]);
  const empty = talk.messages.length === 0 && model.cards.length === 0 && !talk.error;
  return (
    <div className="lg-scroll fades" tabIndex={0} role="log" aria-label="Conversation" onScroll={fadeOnScroll}>
      {empty && talk.project?.steps.length ? <Plan project={talk.project} /> : empty ? <Empty model={model} /> : null}
      <div className="rail">
        {talk.messages.map((m) => (
          <Message key={m.id} m={m} onOpen={actions.descend} />
        ))}
        {talk.error ? (
          <div className="msg msg-stop" data-tone="fail" role="alert">
            <span className="node" />
            <div className="eyebrow msg-who">The turn stopped</div>
            <div className="txt">{talk.error.sentence}</div>
            <details className="d-rawbox">
              <summary className="d-rawbtn">Technical record</summary>
              <pre className="d-raw">{`${talk.error.reason}\n${talk.error.detail}`}</pre>
            </details>
          </div>
        ) : null}
        {talk.working ? (
          <div className="msg msg-her" data-tone="running" aria-live="polite">
            <span className="node" />
            <div className="eyebrow msg-who">Athena</div>
            <div className="txt working">
              {model.tape.cur.what}…
              <button type="button" className="aw-textbtn" data-act="stop" aria-label="Stop her working" onClick={actions.stop}>
                Stop
              </button>
            </div>
          </div>
        ) : null}
        <Gate model={model} />
      </div>
      {talk.messages.length ? (
        <button type="button" className="aw-textbtn lg-clear" data-act="clear" onClick={actions.clear}>
          Clear the conversation
        </button>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function Compose({ model }: { model: CompanionModel }) {
  const { talk, actions } = model;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("message") as HTMLTextAreaElement | null;
    const value = input?.value.trim() ?? "";
    if (!value || talk.blocked) return;
    if (input) input.value = "";
    actions.send(value);
  };
  return (
    <div className="lg-foot">
      {talk.project ? (
        <p className="lg-project" role="status">
          <span className="eyebrow">Working on</span>
          <span className="lg-project__title">{talk.project.title}</span>
          <button type="button" className="aw-textbtn" aria-label={`Stop working on ${talk.project.title}`} onClick={actions.clearProject}>
            done
          </button>
        </p>
      ) : null}
      {talk.setup ? (
        <p className="lg-project" role="status">
          <span className="eyebrow">Setting up</span>
          <span className="lg-project__title">One Athena on this computer</span>
          <button type="button" className="aw-textbtn" aria-label="Leave the setup conversation" onClick={actions.leaveSetup}>
            leave
          </button>
        </p>
      ) : null}
      <form className="lg-compose" onSubmit={submit}>
        {/* Keyed by the offer, so a command Main hands over (ADR 0040) lands as the draft and the
            person's own typing is never overwritten by a re-render. */}
        <textarea
          key={talk.draft.n}
          className="composer"
          name="message"
          aria-label="Message Athena"
          placeholder="Tell Athena what to do"
          autoComplete="off"
          rows={talk.draft.text ? 3 : 1}
          defaultValue={talk.draft.text}
          autoFocus={talk.draft.n > 0}
          disabled={!!talk.blocked}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="button"
          className="iconbtn talk"
          data-act="talk"
          aria-label="Talk to her: hold and speak"
          title={model.micAvailable ? "Hold to talk" : "Voice is not available on this computer yet"}
          disabled={!model.micAvailable}
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
        </button>
        <button type="submit" className="sendbtn" aria-label="Send" disabled={!!talk.blocked}>
          <Icon name="send" />
        </button>
      </form>
      {talk.blocked ? <p className="lg-note">{talk.blocked}</p> : null}
    </div>
  );
}
