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
import ProblemNote from "@/components/ProblemNote";
import { engineLabel, remedyFor } from "@/lib/engines";
import {
  engineFact,
  isReady,
  micFact,
  notReadyBecause,
  pageFact,
  restartNotice,
  voiceFact,
  type Fact,
} from "@/modules/setup/readiness";
import type { SetupModel } from "@/modules/setup/model";

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

  const engine = engineFact(model);
  const page = pageFact(model);
  const mic = micFact(model);
  const voice = voiceFact(model);
  const ready = isReady(model);
  const notice = restartNotice(model);

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
                data-done={lit[i]}
                onClick={() => setStep(i as 0 | 1 | 2)}
              >
                <span className="waking__step-n">{i + 1}</span>
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
            {model.startFailure && (
              <ProblemNote
                title={model.startFailure.title}
                reason={model.startFailure.reason}
                tone="error"
                onRetry={model.actions.restart}
                retryLabel={model.startFailure.actionLabel}
              />
            )}
            {notice && (
              <div className="waking__notice" role="status">
                <p>
                  <b>{notice.title}</b> {notice.detail}
                </p>
                <Button variant="primary" size="sm" onClick={model.actions.restart}>
                  {notice.actionLabel}
                </Button>
              </div>
            )}
            <ul className="waking__engines">
              {model.engines.map((e) => {
                const chosen = model.engine === e.id;
                const state = e.probe?.state ?? "unknown";
                return (
                  <li key={e.id} className="waking__engine" data-chosen={chosen} data-state={state}>
                    <div className="waking__engine-head">
                      <h2>{e.label}</h2>
                      <span className="waking__badge" data-state={state}>
                        {state === "found" ? "found" : state === "not_logged_in" ? "not signed in" : state === "not_found" ? "not found" : "checking"}
                      </span>
                    </div>
                    <p className="waking__engine-line">
                      {e.probe ? remedyFor(e.probe) : "Athena has not heard back about this engine yet."}
                    </p>
                    {e.probe?.detail && state === "found" && <p className="waking__mono">{e.probe.detail}</p>}
                    <Button
                      variant={chosen ? "primary" : "secondary"}
                      size="sm"
                      disabledReason={e.disabledReason}
                      onClick={() => model.actions.chooseEngine(e.id)}
                      aria-pressed={chosen}
                    >
                      {chosen ? "Chosen" : `Use ${e.label}`}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="waking__row">
              <Button size="sm" onClick={model.actions.checkEngines} disabled={model.checking}>
                {model.checking ? "Checking..." : "Check again"}
              </Button>
              <span className="waking__fact" data-standing={engine.standing}>
                {engine.summary}
              </span>
            </div>
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
                if (url.trim() !== "") model.actions.openPage(url.trim());
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
                <Button variant="primary" size="sm" type="submit" disabled={url.trim() === ""}>
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
              Next: {STEPS[step + 1].ask.toLowerCase().replace("?", "")}
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
