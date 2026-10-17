/**
 * The studio, drawn as an act — README section 3.1, ADR 0028, 0087 and 0089.
 *
 * Five steps (engine, install, pick, hear, ready) on a rail that the person can walk back along,
 * and one of them under attention: it takes the middle of the frame as display type, a drawing
 * made for it and its one card. While she speaks the waveform of her real voice is the hero; while
 * a take records it is the microphone's level, drawn as a waveform and labelled stylised. Every
 * state still says what is true in plain words (her line for the step, the daemon's reasons).
 *
 * A pure function of the model, the way the module's studio was. The keys are the module's own
 * table (`keyAction`), carried out by `keys.ts` on the document, so the chips in the dock and the
 * keyboard cannot disagree.
 */
import { useEffect, useRef, type RefObject } from "react";

import VoiceArt from "@/art/voice";
import Bell from "@/bell/Bell";
import type { Pose } from "@/bell/pose";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import StatusDot from "@/components/StatusDot";
import {
  STEP_LABEL,
  STEP_ORDER,
  kokoroSize,
  sttName,
  voiceMeta,
  type StepId,
  type VoiceModel,
} from "@/modules/voice/model";
import { EngineState, InstallBlock, Kbd } from "@/modules/voice/parts";
import { primary, KeyField, WhisperModels } from "@/modules/voice/pieces";

import { perform, studioKey } from "./keys";
import { Chip, HOTKEY, HoldButton, Hero, useTakeEndsWithPlace } from "./parts";

const TITLE: Record<Exclude<StepId, "ready">, string> = {
  engine: "Who speaks for her?",
  install: "Putting her voice on this machine",
  pick: "Hear her.",
  hear: "Now, let her hear you.",
};

const MARK = { done: "✓", current: "›", skipped: "–", todo: "·" } as const;

function poseOf(model: VoiceModel): Pose {
  if (model.hear.recording) return "hearing";
  if (model.preview.phase === "synth" || model.preview.phase === "playing" || model.install.busy) return "working";
  return "resting";
}

/** Document-level keys while the studio is on screen; see `keys.ts` for why not an element. */
function useStudioKeys(model: VoiceModel, root: RefObject<HTMLElement | null>): void {
  const latest = useRef(model);
  useEffect(() => {
    latest.current = model;
  });
  useEffect(() => {
    const on = (phase: "down" | "up") => (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A layer that is leaving is inert: it must not take a key meant for the one arriving.
      if (root.current?.closest("[inert]")) return;
      const act = studioKey(latest.current, e, phase);
      if (act === null) return;
      e.preventDefault();
      perform(latest.current, act);
    };
    const down = on("down");
    const up = on("up");
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, [root]);
  // A take must not outlive the window's focus or the studio (the same rule settings' test take keeps).
  useTakeEndsWithPlace(model);
}

export default function StudioAct({ model }: { model: VoiceModel }) {
  const { studio, actions, dock } = model;
  const root = useRef<HTMLDivElement | null>(null);
  useStudioKeys(model, root);

  const step = studio.step;
  const n = STEP_ORDER.indexOf(step) + 1;
  const title = step === "ready" ? (model.available ? "She is ready." : "Nearly there.") : TITLE[step];
  const recording = step === "hear";
  const speakingStep = step === "pick";
  const kokoroDone = studio.done.includes("install") || model.kokoro?.state === "ready";
  // Space plays only an installed voice and records only when a listener can hear the take
  // (keys.ts), so the hero's quiet line names Space only when it acts.
  const canHear = model.columns.some((c) => c.ready);
  const canPlay = model.voice !== null && model.kokoro?.state === "ready";

  return (
    <div className="vsc vsc--studio" data-step={step} ref={root}>
      <Rail model={model} />

      <div className="vsc-act">
        <header className="vsc-head">
          <div className="vsc-head__art">
            <VoiceArt
              kind="kokoro"
              size={recording || speakingStep ? 112 : 188}
              ring={step === "install" ? (kokoroDone ? 1 : model.install.ring) : undefined}
              speaking={model.preview.phase === "playing"}
            />
            <span className="vsc-stylised">Stylised drawing</span>
          </div>
          {/* The words are keyed by the step so they rise in with it; the live region around them
              is not, because a region mounted with its text already in it is not read out. */}
          <div className="vsc-head__live" aria-live="polite">
            <div className="vsc-head__words" key={step}>
              <p className="vsc-eyebrow">
                Step {n} of {STEP_ORDER.length} · {STEP_LABEL[step]}
              </p>
              <h1 className="vsc-title">{title}</h1>
              <p className="vsc-lead">{model.line}</p>
            </div>
          </div>
        </header>

        {speakingStep || recording ? (
          <div className="vsc-hero">
            <Hero
              source={recording ? "mic" : "voice"}
              active={recording ? model.hear.recording : model.preview.phase === "playing"}
              meters={model.meters}
              idle={
                recording
                  ? canHear
                    ? "Quiet. Hold Space and speak."
                    : "Quiet. No listener is ready to hear a take yet."
                  : canPlay
                    ? "Quiet. Press Space or Play to hear her."
                    : "Quiet. Her voice is not installed yet."
              }
            />
            <p className="vsc-hero__note">
              {recording
                ? "Stylised: drawn from your microphone's level, not a measured spectrum."
                : "Her real voice, live, while she speaks."}
            </p>
          </div>
        ) : null}

        <section className="vsc-card" key={`card-${step}`} data-step={step} aria-label={STEP_LABEL[step]}>
          <Card model={model} />
        </section>

        <footer className="vsc-keys" aria-label="Keys for this step">
          {dock.canBack ? <Chip k="B" label="Back" onPress={() => actions.studio({ t: "back" })} /> : null}
          <span className="vs-push" />
          {dock.canSkip ? <Chip k="S" label="Skip" onPress={() => actions.studio({ t: "skip" })} /> : null}
          <Chip k="Enter" label={dock.primaryLabel} primary disabledReason={dock.primaryDisabledReason} onPress={primary(model)} />
        </footer>
      </div>
    </div>
  );
}

// -- the rail ----------------------------------------------------------------------------------

function Rail({ model }: { model: VoiceModel }) {
  const { actions } = model;
  const receipt = (id: StepId) => model.receipts.find((r) => r.step === id)?.text;
  const reach = [
    { id: "engine", lit: model.studio.done.includes("engine") },
    { id: "voice", lit: model.studio.done.includes("pick") },
    { id: "ears", lit: model.studio.done.includes("hear") },
  ];
  return (
    <aside className="vsc-rail" aria-label="The path">
      <div className="vsc-rail__her">
        <Bell pose={poseOf(model)} reach={reach} size={104} label="Athena" />
        <div className="stack" style={{ gap: 0 }}>
          <b className="typo-heading">Athena</b>
          <span className="typo-caption" aria-live="polite">
            {model.status}
          </span>
        </div>
      </div>

      <ol className="vsc-path">
        {model.stages.map((stage) => (
          <li key={stage.id} className="vsc-stage" data-status={stage.status}>
            <span className="vsc-stage__label">{stage.label}</span>
            <ol className="vsc-steps">
              {stage.steps.map((s) => {
                const open = s.status === "done" || s.status === "skipped";
                return (
                  <li key={s.id} data-status={s.status}>
                    {open ? (
                      <button
                        type="button"
                        className="vsc-step focus-ring"
                        onClick={() => actions.studio({ t: "go", step: s.id })}
                        title={`Go back to ${s.label}`}
                      >
                        <span aria-hidden="true">{MARK[s.status]}</span>
                        {s.label}
                      </button>
                    ) : (
                      <span className="vsc-step" aria-current={s.status === "current" ? "step" : undefined}>
                        <span aria-hidden="true">{MARK[s.status]}</span>
                        {s.label}
                      </span>
                    )}
                    {open && receipt(s.id) ? <span className="vsc-step__note typo-caption">{receipt(s.id)}</span> : null}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>

      <div className="vsc-rail__foot">
        <Button variant="ghost" size="sm" title="Start the studio over from the first step" onClick={() => actions.studio({ t: "restart" })}>
          Restart
        </Button>
        <p className="typo-caption">
          Talk anywhere: hold <Kbd>{HOTKEY}</Kbd>
        </p>
      </div>
    </aside>
  );
}

// -- the cards ---------------------------------------------------------------------------------

function Card({ model }: { model: VoiceModel }) {
  switch (model.studio.step) {
    case "engine":
      return <EngineCard model={model} />;
    case "install":
      return (
        <InstallBlock
          view={model.install}
          home={model.config?.home ?? null}
          sizeMb={model.kokoro?.size_mb ?? null}
          refusal={model.installError}
          onInstall={() => model.actions.install("kokoro")}
          onCheck={model.actions.refresh}
        />
      );
    case "pick":
      return <PickCard model={model} />;
    case "hear":
      return <HearCard model={model} />;
    case "ready":
      return <ReadyCard model={model} />;
  }
}

function EngineCard({ model }: { model: VoiceModel }) {
  const { kokoro } = model;
  return (
    <div className="stack">
      <div className="vsc-opts" role="group" aria-label="Her voice engine">
        <button
          type="button"
          className="vsc-opt focus-ring"
          aria-pressed={model.studio.engineChosen}
          onClick={() => model.actions.studio({ t: "choose_engine" })}
        >
          <Kbd>1</Kbd>
          <span className="typo-heading">{["Kokoro — local, private", kokoroSize(model.kokoro)].filter(Boolean).join(", ")}</span>
          <span className="typo-label vs-tag">Recommended</span>
          <span className="vsc-opt__state">
            {kokoro ? <EngineState engine={kokoro} /> : <span className="typo-caption">Not reported by the daemon.</span>}
          </span>
        </button>
      </div>
      <p className="typo-caption">
        Kokoro runs on this computer; what she says is never sent anywhere. More engines can join later — the flow
        will not change.
      </p>
    </div>
  );
}

function PickCard({ model }: { model: VoiceModel }) {
  const { voice, kokoro, preview } = model;
  if (!voice) return <p className="typo-body">Kokoro lists no voices. Check again once it is installed.</p>;
  const mine = preview.voice === voice.id;
  const playing = mine && preview.phase === "playing";
  const synth = mine && preview.phase === "synth";
  const notReady = kokoro?.state === "ready" ? undefined : "Her voice is not installed yet.";
  return (
    <div className="stack">
      <div className="vsc-voice" data-playing={playing ? "true" : "false"} data-picked={model.studio.voice === voice.id ? "true" : "false"}>
        <div className="vsc-voice__head">
          <h2 className="typo-heading">{voice.name}</h2>
          {model.studio.voice === voice.id ? <span className="typo-label vs-tag">Her voice</span> : null}
          <span className="typo-caption vs-push">{voiceMeta(voice)}</span>
        </div>
        {voice.blurb ? <p className="typo-body">{voice.blurb}</p> : null}
        <span className="row">
          <Button
            size="sm"
            variant={playing ? "primary" : "secondary"}
            disabledReason={notReady}
            aria-pressed={playing}
            onClick={() => model.actions.togglePreview(voice.id)}
          >
            <Kbd>Space</Kbd>
            {playing ? "Stop" : synth ? "Getting ready..." : "Play"}
          </Button>
        </span>
        {mine && preview.phase === "error" && preview.error ? (
          <p className="typo-caption vs-error" role="alert">
            {preview.error}
          </p>
        ) : null}
      </div>
      <p className="typo-body">
        {model.studio.wokeUp ? "Next, she says: " : "Her first words will be: "}“{model.previewLine}”
      </p>
    </div>
  );
}

function HearCard({ model }: { model: VoiceModel }) {
  const { hear, columns, actions } = model;
  const anyReady = columns.some((c) => c.ready);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <span className="row">
        <HoldButton
          recording={hear.recording}
          disabledReason={anyReady ? undefined : "No listener is ready yet — install a Whisper model or add a key below."}
          onStart={actions.recordStart}
          onStop={actions.recordStop}
        />
        <span className="typo-caption">Hold Space or this button, say anything, then let go.</span>
      </span>
      {hear.micError ? (
        <p className="typo-caption vs-error" role="alert">
          {hear.micError}
        </p>
      ) : null}
      <div className="vsc-takes">
        {columns.map((col, i) => (
          <div key={col.id} className="vsc-take" data-picked={col.picked ? "true" : "false"} data-muted={col.ready ? "false" : "true"}>
            <div className="vsc-take__head">
              <VoiceArt kind={col.id === "openai" ? "openai" : "whisper"} size={44} />
              <span className="typo-heading">{col.name}</span>
              <span className="typo-label vs-tag" data-cloud={col.where === "cloud" ? "true" : "false"}>
                {col.where}
              </span>
              {col.take.ms !== null ? <span className="typo-data vs-push">{col.take.ms} ms</span> : null}
            </div>
            <p className="typo-body vsc-take__body" data-state={col.take.state}>
              <StatusDot tone={col.take.state === "failed" ? "error" : col.ready ? (col.picked ? "success" : "info") : "neutral"} />{" "}
              {col.body}
            </p>
            {col.id === "whisper" ? <WhisperModels model={model} /> : null}
            {col.id === "openai" && !col.ready ? <KeyField model={model} /> : null}
            <span className="row">
              <Button
                size="sm"
                variant={col.picked ? "primary" : "secondary"}
                aria-pressed={col.picked}
                disabledReason={col.ready ? undefined : (col.reason ?? "Not ready.")}
                onClick={() => actions.studio({ t: "pick_stt", engine: col.id })}
              >
                <Kbd>{String(i + 1)}</Kbd>
                {col.picked ? "Picked" : "Use this one"}
              </Button>
            </span>
          </div>
        ))}
      </div>
      {model.studio.stt ? (
        <p className="typo-body">
          {sttName(model.studio.stt, model.studio.stt === "whisper" ? (model.config?.stt.model ?? null) : null)} is picked.
          Press Enter to keep it.
        </p>
      ) : null}
    </div>
  );
}

function ReadyCard({ model }: { model: VoiceModel }) {
  const her = model.styleHer.find((l) => l.step === "pick")?.value ?? "not chosen";
  const hears = model.styleHears[0]?.value ?? "not chosen";
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Facts>
        <Fact label="Her voice">{her}</Fact>
        <Fact label="Hears you with">{hears}</Fact>
        <Fact label="Voice">
          <span className="row row--baseline">
            <StatusDot tone={model.available ? "success" : "warning"} />
            {model.available ? "ready" : model.reason}
          </span>
        </Fact>
      </Facts>
      <p className="typo-body">
        Hold <Kbd>{HOTKEY}</Kbd> anywhere to talk to her; let go and she answers.
      </p>
      {model.finishError ? (
        <p className="typo-caption vs-error" role="alert">
          Not kept: {model.finishError}. The studio stays open; press Enter to try again.
        </p>
      ) : null}
    </div>
  );
}
