/**
 * The surface — README section 3.1, ADR 0026, 0087.
 *
 * Athena at the top of the water and the five lights beneath her. The thing under attention takes
 * the centre: hover or focus a light and her tendrils lean toward it and its name fills the
 * marquee; otherwise the marquee is what she is doing. A pure function of the model, with only the
 * view's own state (what is hovered, what is being typed).
 *
 * The ask box is the mirror's hand-over (decision D1): it gives the sentence to her own window, and
 * says so. It never claims an answer.
 *
 * Her illustration is the switch for her own window (fleet-surfaces D2): a press shows it when it
 * is put away and puts it away when it is out, and the button's name says which it will do. The
 * tasks she has delegated sit under her, in the same column.
 *
 * What needs the person is a short list under the line: each entry names the thing and why, and
 * its press lands on that item. At most three are drawn; the rest are one press to their depth.
 */
import { lazy, Suspense, useState, type FormEvent } from "react";

import Glyph from "@/art/glyphs";
import Bell from "@/bell/Bell";
import { ROOTS, type Root } from "@/depth/model";
import type { View } from "@/modules/types";

import type { SurfaceModel } from "./model";
import { SurfaceTasks } from "./tasks";
import "./surface.css";

type Sent = "idle" | "sending" | "sent" | { problem: string };

/** How many needs the list draws before it says how many more there are. */
const NEEDS_SHOWN = 3;

/** Her face, in its own chunk: fetched only when a face is chosen (`./face`). */
const SurfaceFace = lazy(() => import("./face"));

const SurfaceView: View<SurfaceModel> = ({ model }) => {
  const [focused, setFocused] = useState<Root | null>(null);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Sent>("idle");

  const light = model.lights.find((l) => l.root === focused) ?? null;
  // The five lights sit left to right, so the lean is where the focused one is along them.
  const lean = focused === null ? 0 : (ROOTS.indexOf(focused) - (ROOTS.length - 1) / 2) / ((ROOTS.length - 1) / 2);

  // The press is acknowledged by her window coming forward; a window that does not is said where
  // the hand-over's own outcome is said, in the error colour.
  const summon = () => {
    model.actions.summon().catch((err: unknown) =>
      setSent({ problem: `Her window did not come forward: ${err instanceof Error ? err.message : String(err)}` }),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === "" || !model.canAsk || sent === "sending") return;
    setSent("sending");
    model.actions.ask(text).then(
      () => {
        setDraft("");
        setSent("sent");
      },
      (err: unknown) => setSent({ problem: err instanceof Error ? err.message : String(err) }),
    );
  };

  const shown = model.needs.slice(0, NEEDS_SHOWN);
  const rest = model.needs.slice(NEEDS_SHOWN);

  const bell = <Bell pose={model.pose} reach={model.reach} lean={lean} size={420} label="Athena" />;

  return (
    <div className="surface" data-pose={model.pose}>
      <div className="surface__her">
        <button
          type="button"
          className="surface__bell focus-ring"
          aria-label={model.windowVisible ? "Put Athena's window away" : "Show Athena's window"}
          onClick={() => model.actions.toggle()}
        >
          {model.avatar === "halo" ? (
            bell
          ) : (
            <Suspense fallback={bell}>
              <SurfaceFace avatar={model.avatar} size={420} label={`Athena, ${model.poseWord}`} />
            </Suspense>
          )}
        </button>
        <SurfaceTasks />
      </div>

      <div className="surface__words">
        <p className="surface__eyebrow">{light ? "Dive into" : model.poseWord}</p>
        <h1 className="surface__marquee">{light ? light.label : model.headline}</h1>
        <p className="surface__line" aria-live="polite">
          {light ? light.hint : model.waiting > 0 ? "A decision is waiting for you in her window." : "Ask her for a chore, or dive into a depth below."}
        </p>

        {shown.length > 0 && (
          <ul className="surface__needs" aria-label="What needs you now">
            {shown.map((n) => (
              <li key={n.key}>
                <button type="button" className="surface__need focus-ring" onClick={() => model.actions.dive(n.to)}>
                  <span className="surface__need-label">{n.label}</span>
                  <span className="surface__need-word">{n.word}</span>
                  <span className="surface__need-line">{n.line}</span>
                </button>
              </li>
            ))}
            {rest.length > 0 && (
              <li>
                <button
                  type="button"
                  className="surface__needs-more focus-ring"
                  onClick={() => model.actions.dive({ root: rest[0]!.to.root })}
                >
                  +{rest.length} more
                </button>
              </li>
            )}
          </ul>
        )}

        {model.waiting > 0 && (
          <button type="button" className="surface__summon focus-ring" onClick={summon}>
            Open her window to answer ({model.waiting})
          </button>
        )}

        <form className="surface__ask" onSubmit={submit}>
          <label className="surface__ask-label" htmlFor="surface-ask">
            Ask her
          </label>
          <div className="surface__ask-row">
            <input
              id="surface-ask"
              className="surface__input focus-ring"
              type="text"
              value={draft}
              disabled={!model.canAsk}
              placeholder="Check my flights this year for delays that qualify"
              onChange={(e) => {
                setDraft(e.target.value);
                if (sent !== "idle" && sent !== "sending") setSent("idle");
              }}
              autoComplete="off"
            />
            <button
              type="submit"
              className="surface__send focus-ring"
              disabled={!model.canAsk || draft.trim() === "" || sent === "sending"}
            >
              {sent === "sending" ? "Handing it over…" : "Hand it to her"}
            </button>
          </div>
          <p className="surface__ask-note" role="status" data-tone={typeof sent === "object" ? "error" : undefined}>
            {!model.canAsk
              ? model.askReason
              : sent === "sending"
                ? "Handing it to her window…"
                : sent === "sent"
                  ? "Handed to her window. She answers there."
                  : typeof sent === "object"
                    ? sent.problem
                    : "Your words go to her own window, where she answers and where you approve."}
          </p>
        </form>
      </div>

      <ul className="surface__lights" aria-label="Depths">
        {model.lights.map((l) => (
          <li key={l.root}>
            <button
              type="button"
              className="surface__light focus-ring"
              aria-label={`${l.label}, ${l.stat}${l.attention ? ", needs you" : ""}`}
              data-attention={l.attention}
              data-focused={focused === l.root}
              onMouseEnter={() => setFocused(l.root)}
              onMouseLeave={() => setFocused((f) => (f === l.root ? null : f))}
              onFocus={() => setFocused(l.root)}
              onBlur={() => setFocused((f) => (f === l.root ? null : f))}
              onClick={() => model.actions.dive(l.to)}
            >
              <Glyph root={l.root} size={108} />
              <span className="surface__light-name">{l.label}</span>
              <span className="surface__light-stat">{l.stat}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SurfaceView;
