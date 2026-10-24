/**
 * Her window - ADR 0026 ("Named states"), README section 3.1; the drawing is Bell with Tideline's
 * seal, the winner of the athena-mini-window contest and its merge round, written as a pure
 * function of `CompanionModel`.
 *
 * The seal is the fixed anchor of every resize; a pane of Main's water grows out of it into each
 * named state: a tape while she works, a slip when a decision waits, a ledger whose conversation
 * is a descent. The view fetches nothing, subscribes to nothing and imports no store;
 * `preview.html?surface=athena` renders it against fixtures with inert actions, and
 * `views.test.tsx` renders every one of them to static markup.
 */
import { useState, type CSSProperties, type PointerEvent } from "react";

import { Avatar } from "@/avatar/Avatar";
import { SIZES } from "@/lib/companion";
import { localFaceSource } from "@/lib/face";

import { Icon } from "./icons";
import { Ledger } from "./ledger";
import type { CompanionModel } from "./model";
import { plainOf } from "./rich";
import { Seal } from "./seal";
import { Slip } from "./slip";
import { Welcome } from "./welcome";

import "./tokens.css";
import "./companion.css";

/** A press on the water that is not on a control may become a drag of her window (4px, ADR 0026). */
const CONTROL = "button,input,textarea,select,label,a,summary,details,pre,[role=log],[role=region]";

export default function CompanionView({ model }: { model: CompanionModel }) {
  const { actions } = model;
  const form = model.form;
  const size = SIZES[form];
  const n = model.cards.length;
  const drag = (e: PointerEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest(CONTROL)) return;
    actions.drag(e);
  };
  return (
    <div
      className="aw"
      data-form={form}
      data-side={model.side}
      data-valign={model.valign}
      data-dock={model.docked ?? ""}
      data-attn={model.attn ? "1" : "0"}
      data-quiet={model.quiet ? "1" : "0"}
      data-decided={model.decision ? (model.decision.sending ? "sending" : model.decision.tearing ? "tearing" : "stamped") : undefined}
      data-open={model.opening ? "1" : undefined}
      style={{ "--form-w": `${size.w - (form === "tab" ? 0 : 16)}px`, "--form-h": `${size.h - (form === "tab" ? 0 : 16)}px` } as CSSProperties}
    >
      <div className="aw-water" onPointerDown={drag}>
        <div className="rays" aria-hidden="true" />
        <div className="dust" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <i key={i} />
          ))}
        </div>
        <section key={`${form}-${model.epoch}`} className={`sec sec-${form}`} aria-label={LABELS[form]}>
          {form === "tape" ? <Tape model={model} /> : null}
          {form === "hear" ? <Hear model={model} /> : null}
          {form === "face" ? <Face model={model} /> : null}
          {form === "slip" ? <Slip model={model} /> : null}
          {form === "welcome" ? <Welcome model={model} /> : null}
          {form === "ledger" ? <Ledger model={model} /> : null}
          {form === "tab" ? (
            <Seal kind="tab" state={model.seal} count={n} label={model.sealLabel} onActivate={actions.seal} onPointerDown={actions.drag} />
          ) : null}
        </section>
      </div>
      {form === "tab" ? null : (
        <div className="anchor">
          <Seal state={model.seal} count={n} label={model.sealLabel} onActivate={actions.seal} onPointerDown={actions.drag} />
        </div>
      )}
      {/* One region for her whole life: a reader voices a change inside a region it already watches,
          and a region mounted with its text in it is silent. Keying the words, not the region, makes
          the same sentence said twice a new node, so it is heard twice. */}
      <div className="aw-sr" role="status" aria-live="polite">
        <span key={model.say.n}>{model.say.text}</span>
      </div>
    </div>
  );
}

const LABELS: Record<CompanionModel["form"], string> = {
  seal: "Athena, resting",
  tape: "She is working",
  hear: "She is listening",
  face: "Her face",
  slip: "A decision is waiting for you",
  welcome: "Welcome",
  ledger: "Conversation",
  tab: "Athena, docked",
};

// -- the tape ----------------------------------------------------------------------------------

function Tape({ model }: { model: CompanionModel }) {
  const { tape, talk } = model;
  const said = plainOf([...talk.messages].reverse().find((m) => m.role === "her")?.title ?? "");
  const stopped = tape.done?.text === "stopped";
  // A step that has come back is its own beat (Bell's "result"): done in green, failed in red,
  // until the next one starts.
  const beat = stopped ? "fail" : tape.done ? "ok" : tape.count && tape.cur.ok !== null ? (tape.cur.ok ? "ok" : "fail") : "run";
  const eyebrow = stopped
    ? "Stopped"
    : tape.done
      ? "Done"
      : beat === "ok"
        ? `Done · step ${tape.count}`
        : beat === "fail"
          ? `Could not · step ${tape.count}`
          : tape.count
            ? `Working · step ${tape.count + 1}`
            : "Working";
  const line = stopped ? (tape.done?.detail ?? "") : tape.done ? said || "She is done." : tape.cur.what;
  const sub = stopped ? "" : tape.done ? tape.done.detail : tape.cur.sub || (tape.prev ? tape.prev.what : tape.note);
  return (
    <>
      <div key={line} className="tape tape-swap" data-beat={beat}>
        <div className="eyebrow">{eyebrow}</div>
        <div className={`tape-line${stopped ? " long" : ""}`}>{line}</div>
        {sub ? <div className="tape-sub">{sub}</div> : null}
      </div>
      {tape.done ? null : (
        <div className="thread" aria-hidden="true">
          {Array.from({ length: tape.count + 1 }, (_, i) => (
            <i key={i} className={i < tape.count ? "done" : "live"} />
          ))}
        </div>
      )}
      {talk.working ? (
        <button type="button" className="tape-stop" data-act="stop" aria-label="Stop her working" title="Stop" onClick={model.actions.stop}>
          <Icon name="stop" />
        </button>
      ) : null}
    </>
  );
}

function Hear({ model }: { model: CompanionModel }) {
  return (
    <>
      <div className="tape">
        <div className="eyebrow">Listening · release to send</div>
        <div className="hear-text">
          <span className="hear-words caret" data-tr>
            {model.heard || "…"}
          </span>
        </div>
      </div>
      <div className="meter" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} />
        ))}
      </div>
    </>
  );
}

/** Her face in the face form: the panel's width, less nothing; the caption sits under it. */
const FACE_SIZE = 224;

/**
 * Her face while she talks (the ADR on Athena's face): the chosen form, fed by her own window's
 * signal every frame, with one line under it so what she heard or is saying stays readable. With
 * the halo chosen there is no face form at all; this draws nothing then, defensively.
 */
function Face({ model }: { model: CompanionModel }) {
  const [source] = useState(localFaceSource);
  if (model.avatar === "halo") return null;
  const said = plainOf([...model.talk.messages].reverse().find((m) => m.role === "her")?.title ?? "");
  const line = model.listening ? model.heard || "…" : model.mood === "speak" ? said : model.talk.working ? model.tape.cur.what : said;
  return (
    <>
      <div className="face-art">
        <Avatar avatar={model.avatar} size={FACE_SIZE} source={source} className="fc-face" />
      </div>
      <div className="face-glow" aria-hidden="true" />
      <div className="face-cap">
        <div className="eyebrow">{model.listening ? "Listening" : model.mood === "speak" ? "Speaking" : "Thinking"}</div>
        {line ? <p className="caret">{line}</p> : null}
      </div>
    </>
  );
}
