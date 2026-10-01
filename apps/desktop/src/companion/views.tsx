/**
 * The companion's surface — ADR 0026 ("Named states"), README section 3.1; the drawing is The
 * Countersign's (`athena.js` templates of the winning entry), written as a pure function of
 * `CompanionModel`.
 *
 * Her body is a housing whose top square is the seal. Every state is the seal plus something
 * attached to it: a tape while she works, a slip when a card waits, a book when she is expanded.
 * The view fetches nothing, subscribes to nothing and imports no store; `preview.html?surface=athena`
 * renders it against fixtures with inert actions, and `views.test.tsx` renders every one of them
 * to static markup. The only effect is the ledger keeping its newest line in view.
 *
 * Nothing readable is under 12px, body is 15px, and a gate class is always a word in a box.
 */
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

import { Chip, Defs, Icon, Mark, Ring, Sketch, Stamp } from "./drawing";
import type { LedgerTab } from "./machine";
import type {
  CardView,
  CompanionModel,
  MessageBlock,
  RecordRow,
  StepView,
} from "./model";

import "./companion.css";

const TIERS = [
  { n: 0, name: "remembers" },
  { n: 1, name: "acts" },
  { n: 2, name: "native" },
  { n: 3, name: "reaches" },
];

export default function CompanionView({ model }: { model: CompanionModel }) {
  const { form, actions } = model;
  const hasPaper = form !== "seal" && form !== "tab";
  const cardCount = model.cards.length;
  return (
    <div
      className="aw"
      data-state={form}
      data-side={model.side}
      data-valign={model.valign}
      data-dock={model.docked ?? ""}
      data-tone={model.tone}
      data-cards={String(cardCount)}
      data-attn={model.attn ? "1" : "0"}
      data-quiet={model.quiet ? "1" : "0"}
      data-decided={model.decision?.kind ?? undefined}
      data-listening={model.listening ? "1" : "0"}
    >
      <Defs />
      <div key={`arrive-${model.arrive}`} className={`aw-fig${model.arrive > 0 ? " arrive" : ""}`}>
        <div className="aw-house" onPointerDown={(e) => actions.drag(e)}>
          <div className="aw-sealwrap">
            <button type="button" className="aw-seal" aria-label={model.sealLabel} onClick={actions.seal}>
              <Ring lit={model.lit} working={model.tone === "work"} />
              <span className="aw-face">
                <Mark className="aw-mk" field="var(--house-glow)" cut="#081417" />
              </span>
              <span className="aw-cap">{model.caption}</span>
              <span className="aw-badge" aria-hidden="true">
                {model.badge}
              </span>
            </button>
          </div>
          <div className="aw-rail">
            <Rail model={model} />
          </div>
        </div>
        {hasPaper ? (
          <div
            key={model.epoch}
            className="aw-paper enter"
            data-kind={form}
            data-tear={form === "slip" && model.decision?.tearing ? "1" : undefined}
          >
            {form === "slip" ? <Slip model={model} card={model.cards[0]} inline={false} /> : null}
            {form === "tape" ? <Tape model={model} /> : null}
            {form === "hear" ? <Hear model={model} /> : null}
            {form === "welcome" ? <Welcome model={model} /> : null}
            {form === "ledger" ? <Ledger model={model} /> : null}
          </div>
        ) : null}
      </div>
      <div key={`say-${model.say.n}`} className="aw-sr" role="status" aria-live="polite">
        {model.say.text}
      </div>
    </div>
  );
}

// -- the rail ----------------------------------------------------------------------------------

function Rail({ model }: { model: CompanionModel }) {
  const { form } = model;
  if (form === "ledger") {
    const n = model.cards.length;
    const tabs: Array<[LedgerTab, string, "talk" | "record" | "origin"]> = [
      ["talk", "Talk", "talk"],
      ["record", "Record", "record"],
      ["origins", "Origins", "origin"],
    ];
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const order = tabs.map((t) => t[0]);
      const next = order[(order.indexOf(model.tab) + (e.key === "ArrowDown" ? 1 : -1) + order.length) % order.length];
      model.actions.tab(next);
      e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
      e.preventDefault();
    };
    return (
      <div className="tabs" role="tablist" aria-label="Athena" aria-orientation="vertical" onKeyDown={onKey}>
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-tab={id}
            aria-selected={model.tab === id}
            tabIndex={model.tab === id ? 0 : -1}
            onClick={() => model.actions.tab(id)}
          >
            <Icon name={icon} />
            <span>{label}</span>
            {id === "talk" && n ? <i className="pip-n">{n}</i> : null}
          </button>
        ))}
      </div>
    );
  }
  if (form === "slip") {
    const total = Math.max(1, model.cards.length);
    return (
      <div className="rl-slip">
        <span className="rl-pips" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i === 0 ? "cur" : ""} />
          ))}
        </span>
        <span className="rl-lbl">
          waiting
          <br />
          on you
        </span>
        <span className="rl-key">
          <kbd>A</kbd>
          <kbd>D</kbd>
        </span>
      </div>
    );
  }
  if (form === "welcome") {
    return (
      <ol className="rl-ladder" aria-label="What she can do, by tier">
        {TIERS.map((t) => (
          <li key={t.n} className={t.n === 0 ? "cur" : ""}>
            <b>{t.n}</b>
            <span>{t.name}</span>
          </li>
        ))}
      </ol>
    );
  }
  return null;
}

// -- the slip ----------------------------------------------------------------------------------

function Slip({ model, card, inline }: { model: CompanionModel; card: CardView | undefined; inline: boolean }) {
  const { actions, decision } = model;
  if (!card) {
    return (
      <article className={`slip${inline ? " slip-inline" : ""}`}>
        <p className="sl-why">Nothing is waiting on you.</p>
      </article>
    );
  }
  const total = model.cards.length;
  const count = total > 1 ? `${total} waiting` : "1 waiting";
  const decided = decision !== null;
  return (
    <article
      className={`slip${inline ? " slip-inline" : ""}`}
      data-card={card.id}
      data-decision={decision ? (decision.kind === "approve" ? "approved" : "declined") : undefined}
      aria-label={`Decision card: ${card.action} ${card.id}, waiting on you`}
    >
      <header className="sl-head">
        <Chip cls="GATED" />
        <code className="sl-action">{card.action}</code>
        <span className="sl-count">{count}</span>
      </header>
      <div className="sl-scroll">
        <p className="sl-why">{card.rationale}</p>
        <div className="sl-mid">
          <dl className="sl-params">
            {card.params.map((p) => (
              <div key={p.key}>
                <dt>{p.key}</dt>
                <dd>{p.value}</dd>
              </div>
            ))}
          </dl>
          {card.capture === "sketch" && !inline ? (
            <figure className="sl-thumb">
              <Sketch />
              <figcaption>page capture, stylised</figcaption>
            </figure>
          ) : null}
        </div>
      </div>
      <div className="sl-sign">
        <button type="button" className="aw-btn aw-btn-stamp" data-act="approve" aria-keyshortcuts="A" disabled={decided} onClick={() => actions.approve("click")}>
          Approve <kbd>A</kbd>
        </button>
        <button type="button" className="aw-btn aw-btn-ink" data-act="decline" aria-keyshortcuts="D" disabled={decided} onClick={() => actions.decline("click")}>
          Decline <kbd>D</kbd>
        </button>
        <button
          type="button"
          className="aw-btn aw-btn-ghost"
          data-act="mic"
          aria-label="Hold and say approve or decline"
          title={model.micAvailable ? "Hold and say approve or decline" : "Voice is not available: the daemon has no voice backend"}
          disabled={!model.micAvailable || decided}
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
          <span>Speak</span>
        </button>
      </div>
      <p className="sl-note">
        <span className="sl-note-a">
          {model.micAvailable ? "Nothing runs until you sign. Or say “approve”." : "Nothing runs until you sign."}
        </span>
        <span className="sl-listen">
          <i className="wave">
            {Array.from({ length: 6 }, (_, i) => (
              <b key={i} />
            ))}
          </i>
          <span data-tr>{model.heard || "listening…"}</span>
        </span>
      </p>
      {decision ? (
        <div className="sl-stamp" aria-hidden="true">
          <Stamp kind={decision.kind} by={decision.by} />
        </div>
      ) : null}
    </article>
  );
}

// -- the tape ----------------------------------------------------------------------------------

function Line({ step }: { step: StepView }) {
  return (
    <>
      {step.cls ? <Chip cls={step.cls} /> : null}
      <b>{step.app}</b>
      <span>{step.what}</span>
    </>
  );
}

function Tape({ model }: { model: CompanionModel }) {
  const { tape } = model;
  if (tape.done) {
    return (
      <div className="tape" data-done="1">
        <div className="tp-line on">
          <b>{tape.done.text}</b>
          <span>{tape.done.detail}</span>
        </div>
        <div className="tp-line dim">
          <span className="tp-note">The record has every call. Nothing else is waiting on you.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="tape">
      <div className="tp-line dim">
        {tape.prev ? <Line step={tape.prev} /> : <span className="tp-note">{tape.note}</span>}
      </div>
      <div key={`${tape.cur.app}/${tape.cur.what}`} className="tp-line on in">
        <Line step={tape.cur} />
      </div>
    </div>
  );
}

function Hear({ model }: { model: CompanionModel }) {
  return (
    <div className="hear">
      <i className="wave">
        {Array.from({ length: 14 }, (_, i) => (
          <b key={i} />
        ))}
      </i>
      <div className="hr-txt">
        <span className="hr-lbl">listening · release to send</span>
        <span className="hr-tr" data-tr>
          {model.heard || "…"}
        </span>
      </div>
    </div>
  );
}

// -- welcome -----------------------------------------------------------------------------------

function Welcome({ model }: { model: CompanionModel }) {
  const { actions } = model;
  return (
    <div className="wl" style={{ ["--stamp-delay" as string]: "520ms" }}>
      <p className="eyebrow">First launch</p>
      <h2>Athena is here.</h2>
      <p>
        She works inside the web apps you already have open. She reads one page, decides, acts in another, and asks
        before anything that cannot be undone.
      </p>
      <ul className="wl-facts">
        <li>
          <Icon name="check" className="ok" />
          <span>
            <b>Engine: {model.welcome.engine}.</b> She never asks for a key.
          </span>
        </li>
        <li>
          <Icon name="lock" className="ok" />
          <span>Runs on this machine. No account, no cloud, no telemetry.</span>
        </li>
      </ul>
      <div className="wl-act">
        <button type="button" className="aw-btn aw-btn-primary" data-act="open" onClick={actions.open}>
          Open your first app <kbd>Enter</kbd>
        </button>
        <button type="button" className="aw-btn aw-btn-ghost-ink" data-act="later" onClick={actions.later}>
          Later <kbd>Esc</kbd>
        </button>
      </div>
      <div className="sl-stamp wl-stamp" aria-hidden="true">
        <Stamp kind="welcome" />
      </div>
    </div>
  );
}

// -- the ledger --------------------------------------------------------------------------------

function Ledger({ model }: { model: CompanionModel }) {
  const { actions, tab } = model;
  const head = { talk: "Talk", record: "Record", origins: "Origins" }[tab];
  return (
    <div className="lg">
      <header className="lg-head">
        <h2>{head}</h2>
        <span className="lg-tools">
          {tab === "talk" && model.talk.blocks.length ? (
            <button type="button" className="aw-btn aw-btn-ghost" data-act="clear" onClick={actions.clear}>
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className={`ico-btn${model.pinned ? " on" : ""}`}
            data-act="pin"
            aria-pressed={model.pinned}
            aria-label="Keep Athena on top of other windows"
            title="Keep Athena on top of other windows"
            onClick={actions.pin}
          >
            <Icon name="pin" />
          </button>
          <button type="button" className="ico-btn" data-act="collapse" aria-label="Put the ledger away (Escape)" title="Put the ledger away (Escape)" onClick={actions.esc}>
            <Icon name="down" />
          </button>
        </span>
      </header>
      {tab === "talk" ? <Talk model={model} /> : null}
      {tab === "record" ? <Record model={model} /> : null}
      {tab === "origins" ? <Origins model={model} /> : null}
    </div>
  );
}

function Talk({ model }: { model: CompanionModel }) {
  const { talk, actions } = model;
  const end = useRef<HTMLDivElement>(null);
  const count = talk.blocks.length + model.cards.length;
  useEffect(() => {
    // The newest thing is what she is waiting for; keep it in view as it arrives.
    end.current?.scrollIntoView({ block: "end" });
  }, [count, talk.working]);

  const empty = talk.blocks.length === 0 && model.cards.length === 0 && !talk.error;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("message") as HTMLInputElement | null;
    const value = input?.value.trim() ?? "";
    if (!value || talk.blocked) return;
    if (input) input.value = "";
    actions.send(value);
  };
  return (
    <>
      <div className="lg-scroll" tabIndex={0} role="log" aria-label="Conversation">
        {empty ? (
          <div className="lg-empty">
            <p className="lg-lead">
              {talk.host ? `Ask about ${talk.host}.` : "Open a page, then ask about it."} Nothing she does there runs
              without the gate.
            </p>
            <div className="lg-sugg">
              {talk.suggestions.map((s) => (
                <button key={s} type="button" className="aw-btn aw-btn-sugg" disabled={!!talk.blocked} onClick={() => actions.send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          talk.blocks.map((b) => <Block key={b.id} block={b} />)
        )}
        {talk.error ? (
          <div className="msg msg-error" role="alert">
            <span className="msg-who">The turn stopped</span>
            <p>
              <code>{talk.error.reason}</code> {talk.error.detail}
            </p>
          </div>
        ) : null}
        {talk.working ? (
          <div className="msg msg-athena" aria-live="polite">
            <span className="msg-who">Athena</span>
            <p>{talk.phrase}…</p>
          </div>
        ) : null}
        {model.cards.length ? <Slip model={model} card={model.cards[0]} inline /> : null}
        {model.cards.length > 1 ? <p className="lg-foot">and {model.cards.length - 1} more waiting after this one</p> : null}
        <div ref={end} />
      </div>
      <form className="lg-compose" onSubmit={submit}>
        <input name="message" aria-label="Message Athena" placeholder="Tell Athena what to do" autoComplete="off" disabled={!!talk.blocked} />
        <button type="submit" className="aw-btn aw-btn-primary aw-btn-icon" aria-label="Send" disabled={!!talk.blocked}>
          <Icon name="send" />
        </button>
      </form>
      {talk.blocked ? <p className="lg-note">{talk.blocked}</p> : null}
    </>
  );
}

function Block({ block }: { block: MessageBlock }) {
  if (block.kind === "activity") {
    return (
      <ul className="acts" aria-label="What ran">
        {block.steps.map((s) => (
          <li key={s.id} data-ok={s.ok === false ? "0" : "1"}>
            {s.text}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`msg msg-${block.kind === "user" ? "you" : "athena"}`}>
      <span className="msg-who">{block.kind === "user" ? "You" : "Athena"}</span>
      <p>{block.text}</p>
    </div>
  );
}

function Record({ model }: { model: CompanionModel }) {
  const { session, decisions, ledger } = model.record;
  return (
    <div className="lg-scroll" tabIndex={0}>
      <p className="lg-lead">Every call, by app and gate class. Nothing is missing from this list.</p>
      <h3 className="lg-h">This session</h3>
      {session.length === 0 && decisions.length === 0 ? (
        <p className="lg-foot">Nothing has run in this window yet.</p>
      ) : (
        <ol className="rec">
          {decisions.map((d) => (
            <li key={d.id}>
              <Chip cls="GATED" />
              <span className="rec-t">{d.action}</span>
              <span className={`rec-r rec-${d.result}`}>{d.result}</span>
            </li>
          ))}
          {session.map((r: RecordRow) => (
            <li key={r.id}>
              {r.cls ? <Chip cls={r.cls} /> : null}
              <span className="rec-t">{r.tool}</span>
              <span className="rec-a">{r.app}</span>
              <span className={`rec-r rec-${r.result}`}>{r.result}</span>
            </li>
          ))}
        </ol>
      )}
      {session.length || decisions.length ? (
        <p className="lg-foot">(showing {session.length + decisions.length} of {session.length + decisions.length})</p>
      ) : null}
      <h3 className="lg-h">Model calls, from the daemon</h3>
      {ledger === null ? (
        <p className="lg-foot">The daemon has not answered yet.</p>
      ) : ledger.problem ? (
        <p className="lg-foot" role="alert">
          Could not be read: {ledger.problem}
        </p>
      ) : ledger.rows.length === 0 ? (
        <p className="lg-foot">No model call has been made.</p>
      ) : (
        <>
          <ol className="rec">
            {ledger.rows.map((r) => (
              <li key={r.id}>
                <span className="rec-t">{r.when.slice(11, 16) || "—"}</span>
                <span className="rec-a">{r.model}</span>
                <span className={`rec-r ${r.isError ? "rec-user_denied" : ""}`}>
                  {r.isError ? r.reason || "error" : `${r.rounds} round${r.rounds === 1 ? "" : "s"}, ${r.cost}`}
                </span>
              </li>
            ))}
          </ol>
          {ledger.footer ? <p className="lg-foot">{ledger.footer}</p> : null}
        </>
      )}
    </div>
  );
}

function Origins({ model }: { model: CompanionModel }) {
  const { origins, actions } = model;
  return (
    <div className="lg-scroll" tabIndex={0}>
      <p className="lg-lead">
        {origins.host ? `What ${origins.host} offers her, and who she may act for.` : "No page is open."}
      </p>
      <h3 className="lg-h">This page offers</h3>
      {origins.offers.length === 0 ? (
        <p className="lg-foot">Nothing registered yet. Her generic hands are gated on first sight.</p>
      ) : (
        <ul className="offers">
          {origins.offers.map((o) => (
            <li key={o.name}>
              <Chip cls={o.cls} />
              <b>{o.name.split(".").slice(-1)[0]}</b>
              <span>{o.description || o.name}</span>
            </li>
          ))}
        </ul>
      )}
      {origins.offersFooter ? <p className="lg-foot">{origins.offersFooter}</p> : null}
      <h3 className="lg-h">Apps she has seen</h3>
      {origins.known.length === 0 ? (
        <p className="lg-foot">None yet. A page's tools are off until you say otherwise.</p>
      ) : (
        <ul className="offers">
          {origins.known.map((k) => (
            <li key={k.origin}>
              <b>{k.origin.replace(/^https?:\/\//, "")}</b>
              <span>{k.enabled ? "enabled" : "off"}{k.overrides ? `, ${k.overrides} pinned` : ""}</span>
              <button
                type="button"
                className="aw-btn aw-btn-ghost aw-btn-toggle"
                aria-pressed={k.enabled}
                onClick={() => actions.setOrigin(k.origin, !k.enabled)}
              >
                {k.enabled ? "Disable" : "Enable"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
