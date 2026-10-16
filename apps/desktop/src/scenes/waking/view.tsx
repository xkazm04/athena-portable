/**
 * The first act: waking her — README section 3.1 and 3.5, ADR 0085 and 0087.
 *
 * Setup is not a page you visit once and abandon; it is the opening of the same scene the person
 * will live in. Three things wake her: a mind (the engine), a reach (the first app) and,
 * if you like, a voice. Each one done lights a tendril, and when the first two are done she wakes.
 *
 * A pure view over the Setup module's own view-model, so every rule the letter had stays where it
 * was: `engineFact`, `pageFact` and `micFact` say what is true, `isReady` and `notReadyBecause`
 * gate the last step and explain themselves, and nothing here stores a verdict. The words are the
 * letter's: the engine's remedy comes from `remedyFor`, the failure to start from the model.
 */
import { useState } from "react";

import Bell from "@/bell/Bell";
import Button from "@/components/Button";
import { engineLabel } from "@/lib/engines";
import { normaliseUrl } from "@/lib/url";
import { originOf } from "@/modules/browser/model";
import {
  engineFact,
  isReady,
  micFact,
  notReadyBecause,
  pageFact,
  voiceFact,
  type Fact,
} from "@/modules/setup/readiness";
import type { SetupModel } from "@/modules/setup/model";
import EngineSection from "@/scenes/shared/EngineSection";

import "./waking.css";

const STEPS = [
  { key: "mind", name: "Mind", ask: "What will she think with?" },
  { key: "reach", name: "Reach", ask: "Where will she work?" },
  { key: "voice", name: "Voice", ask: "Do you want to talk to her?" },
] as const;

export interface WakingProps {
  model: SetupModel;
  /** Leave the first act for now and look around; the letter is still there from the surface. */
  onLater: () => void;
  /** Open at a step, for the preview and for tests. */
  initialStep?: 0 | 1 | 2;
}

const BADGE: Record<Fact["standing"], string> = {
  done: "ready",
  todo: "not yet",
  missing: "not ready",
  unknown: "checking",
};

export default function WakingView({ model, onLater, initialStep = 0 }: WakingProps) {
  const [step, setStep] = useState<0 | 1 | 2>(initialStep);
  const [url, setUrl] = useState("");
  // What the apps register opens, this opens: a bare host gets its scheme (Rust's parser refuses
  // one without, and that refusal was only logged), and text that names no origin stays here with
  // the reason, as the register keeps it.
  const address = normaliseUrl(url);
  const origin = address ? originOf(address) : "";
  const openable = origin !== "" && origin !== "null";
  const openReason = !url.trim()
    ? "Type an address first."
    : openable
      ? undefined
      : "That is not an address an app can live at.";

  const engine = engineFact(model);
  const page = pageFact(model);
  const mic = micFact(model);
  const voice = voiceFact(model);
  const ready = isReady(model);

  const lit = [engine.standing === "done", page.standing === "done", mic.standing === "done" || voice.standing === "done"];
  const reach = STEPS.map((s, i) => ({ id: s.key, lit: lit[i]! }));
  const caption = !lit[0]
    ? "She has no mind yet."
    : !lit[1]
      ? "She has a mind."
      : lit[2]
        ? "She can think, work and hear you."
        : "She has a mind and somewhere to work.";

  return (
    <div className="waking" data-step={step}>
      <aside className="waking__her">
        <Bell pose="resting" reach={reach} size={380} label="Athena" />
        <p className="waking__caption">{caption}</p>
        <p className="waking__sub">Three things and she wakes. Each one you choose lights a part of her.</p>
      </aside>

      <section className="waking__act" aria-labelledby="waking-ask">
        <ol className="waking__steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className="waking__step focus-ring"
                aria-current={step === i ? "step" : undefined}
                aria-label={lit[i] ? `${s.name}, done` : s.name}
                data-done={lit[i]}
                onClick={() => setStep(i as 0 | 1 | 2)}
              >
                <span className="waking__step-n" aria-hidden="true">
                  {lit[i] ? "✓" : i + 1}
                </span>
                {s.name}
              </button>
            </li>
          ))}
        </ol>

        <p className="waking__eyebrow">
          Step {step + 1} of 3 · her {STEPS[step].name.toLowerCase()}
        </p>
        <h1 id="waking-ask" className="waking__ask">
          {STEPS[step].ask}
        </h1>

        {step === 0 && (
          <>
            <p className="waking__lead">
              Athena borrows a mind from an engine already on this computer. No key is typed here.
              {model.probes === null ? " She is looking." : " She looked; this is what answered."}
            </p>
            <EngineSection model={model} />
          </>
        )}

        {step === 1 && (
          <>
            <p className="waking__lead">
              Athena works inside a web app you already use. Open the first one and she will read what
              it offers; she asks before anything that cannot be undone.
            </p>
            <form
              className="waking__open"
              onSubmit={(e) => {
                e.preventDefault();
                if (address && openable) model.actions.openPage(address);
              }}
            >
              <label htmlFor="waking-url">Address of an app</label>
              <div className="waking__row">
                <input
                  id="waking-url"
                  className="waking__input focus-ring"
                  type="text"
                  value={url}
                  placeholder="https://your-app.example.com"
                  onChange={(e) => setUrl(e.target.value)}
                  autoComplete="off"
                />
                <Button variant="primary" size="sm" type="submit" disabledReason={openReason}>
                  Open it
                </Button>
              </div>
            </form>
            <p className="waking__fact" data-standing={page.standing}>
              {BADGE[page.standing]} · {page.summary}
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <p className="waking__lead">
              A microphone is optional: without one she takes your words typed. If you want to talk, the
              window asks once and lets go at once.
            </p>
            <div className="waking__row">
              <Button size="sm" onClick={model.actions.checkMic}>
                Check my microphone
              </Button>
              <span className="waking__fact" data-standing={mic.standing}>
                {BADGE[mic.standing]} · {mic.summary}
              </span>
            </div>
            <p className="waking__fact" data-standing={voice.standing}>
              Her voice: {voice.summary}
            </p>
          </>
        )}

        <div className="waking__foot">
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep((step + 1) as 1 | 2)}>
              Next: {STEPS[step + 1].name}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={model.actions.finish}
              disabledReason={ready ? undefined : notReadyBecause(model)}
            >
              Wake her
            </Button>
          )}
          <button type="button" className="waking__later focus-ring" onClick={onLater}>
            Later
          </button>
          {step === 2 && !ready && <p className="waking__why">{notReadyBecause(model)}</p>}
          <p className="waking__engine-now">{engineLabel(model.engine)} is the chosen engine.</p>
        </div>
      </section>
    </div>
  );
}
