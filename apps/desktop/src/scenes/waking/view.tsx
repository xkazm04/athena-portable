/**
 * The first act: waking her — README section 3.1 and 3.5, ADR 0085 and 0087.
 *
 * Setup is not a page you visit once and abandon; it is the opening of the same scene the person
 * will live in. Two things wake her: a mind (the engine) and a reach (the first app); a voice and a
 * face are hers if you like (the ADR on Athena's face). Each one done lights a tendril, and when the
 * first two are done she wakes.
 *
 * A pure view over the Setup module's own view-model, so every rule the letter had stays where it
 * was: `engineFact`, `pageFact` and `micFact` say what is true, `isReady` and `notReadyBecause`
 * gate the last step and explain themselves, and nothing here stores a verdict. The words are the
 * letter's: the engine's remedy comes from `remedyFor`, the failure to start from the model.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { AvatarId } from "@/avatar/types";
import Bell from "@/bell/Bell";
import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import { engineLabel } from "@/lib/engines";
import { normaliseUrl } from "@/lib/url";
import { originOf } from "@/modules/browser/model";
import { engineFact, isReady, micFact, notReadyBecause, pageFact, voiceFact } from "@/modules/setup/readiness";
import type { SetupModel } from "@/modules/setup/model";
import EngineSection from "@/scenes/shared/EngineSection";

import { LAST, STEPS, factLine, litSteps, openingStep, type Step } from "./steps";
import "./waking.css";

/** The Face step, in its own chunk: fetched when the step is first drawn (first paint, ADR 0095). */
const FaceStep = lazy(() => import("./face-step"));

export interface WakingProps {
  model: SetupModel;
  /** Leave the first act for now and look around; the letter is still there from the surface. */
  onLater: () => void;
  /** Open at a step, for the preview and for tests; overrides `kept` and the frontier. */
  initialStep?: Step;
  /** The step the person was on this session (ADR 0223); without one the act opens on its frontier. */
  kept?: Step | null;
  /** The person moved to a step: the keeper remembers it for the session. */
  onStep?: (step: Step) => void;
  /** Leave for the voice studio from the Voice step, while her voice is not available. */
  onVoice?: () => void;
  /** How she appears now (the `avatar` setting); the halo when not given. */
  avatar?: AvatarId;
  /** Choose how she appears: writes the `avatar` setting. */
  onAvatar?: (avatar: AvatarId) => void;
}

export default function WakingView({
  model,
  onLater,
  initialStep,
  kept = null,
  onStep,
  onVoice,
  avatar = "halo",
  onAvatar,
}: WakingProps) {
  // Where the act is: a step given or kept, else the first one still owed (ADR 0223). The frontier
  // follows the model only until the engine has answered; then it holds, so opening a page on Reach
  // does not move the act out from under the person.
  const [chosen, setChosen] = useState<Step | null>(initialStep ?? kept);
  const opening = openingStep(model, avatar, null);
  const settled = engineFact(model).standing !== "unknown";
  const step = chosen ?? opening;
  // Adjusted while rendering, not in an effect: the value drawn does not change, it only stops moving.
  if (chosen === null && settled) setChosen(opening);
  const moveTo = (to: Step) => {
    setChosen(to);
    onStep?.(to);
  };
  const [url, setUrl] = useState("");
  // Next on the second step turns into Wake her. When she is not ready that button is a different
  // element (the reason's focusable wrapper around a disabled button), so the one that was pressed
  // leaves the page and the keyboard with it: put it on the way forward that replaced it.
  const foot = useRef<HTMLDivElement | null>(null);
  const forward = useRef(false);
  useEffect(() => {
    if (!forward.current) return;
    forward.current = false;
    const at = foot.current;
    if (!at || at.contains(document.activeElement)) return;
    at.querySelector<HTMLElement>("[tabindex], button")?.focus();
  }, [step]);
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

  const page = pageFact(model);
  const mic = micFact(model);
  const voice = voiceFact(model);
  const ready = isReady(model);

  const lit = litSteps(model, avatar);
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
        <p className="waking__sub">Each one you choose lights a part of her.</p>
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
                onClick={() => moveTo(i as Step)}
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
          Step {step + 1} of {STEPS.length} · her {STEPS[step].name.toLowerCase()}
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
              {factLine(page)}
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
                {factLine(mic)}
              </span>
            </div>
            <p className="waking__fact" data-standing={voice.standing}>
              Her voice: {voice.summary}
            </p>
            {onVoice && !model.voiceAvailable && (
              <Button size="sm" onClick={onVoice}>
                Set up her voice in the studio
              </Button>
            )}
          </>
        )}

        {step === 3 && (
          <Suspense fallback={null}>
            <FaceStep avatar={avatar} onAvatar={onAvatar} />
          </Suspense>
        )}

        <div className="waking__foot" ref={foot}>
          {step < LAST ? (
            <Button
              variant="primary"
              onClick={() => {
                forward.current = true;
                moveTo((step + 1) as Step);
              }}
            >
              Next: {STEPS[step + 1].name}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={model.actions.finish}
              disabledReason={
                !ready ? notReadyBecause(model) : model.waking ? "Storing that she is awake." : undefined
              }
            >
              {model.waking ? "Waking her…" : "Wake her"}
            </Button>
          )}
          <button type="button" className="waking__later focus-ring" onClick={onLater}>
            Later
          </button>
          {step === LAST && !ready && <p className="waking__why">{notReadyBecause(model)}</p>}
          {step === LAST && model.refusals.wake && (
            <ProblemNote
              title="She is not awake yet: this could not be stored. Press Wake her to try again."
              reason={model.refusals.wake}
              tone="error"
            />
          )}
          <p className="waking__engine-now">{engineLabel(model.engine)} is the chosen engine.</p>
        </div>
      </section>
    </div>
  );
}
