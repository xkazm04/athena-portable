/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the studio.
 *
 * Personas' "Table" studio, ported as a design and not as code: the conversation owns the page.
 * On the left, the path — three stages on a line that fills as the person moves. In the centre,
 * her presence (an orb whose ring is the install and whose glow is her voice), then the thread:
 * every answered step folded into a dashed receipt with "change", her line for this step, and the
 * one live card, risen into place. Under it the dock, which shows the keys for this moment and no
 * others. On the right, her card writes itself as the person decides, "not yet" until they have.
 *
 * Pure: everything is read from the model and every act is a call on `model.actions`. The keys
 * are one table (`keyAction` in the model), so a chip in the dock and the key it names cannot
 * disagree.
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";

import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import PillGroup from "@/components/PillGroup";
import StatusDot from "@/components/StatusDot";
import { TextInput } from "@/components/FormField";

import {
  STEP_LABEL,
  STEP_ORDER,
  keyAction,
  sttName,
  type StepId,
  type StyleLine,
  type VoiceModel,
} from "./model";
import { EngineState, HoldToTalk, InstallBlock, Kbd, VoiceTile } from "./parts";
import { Orb } from "./waveform";

/** What Enter does on the current step, as one call. */
export function primary(model: VoiceModel): () => void {
  const { actions, studio, install, dock } = model;
  if (dock.primaryDisabledReason) return () => {};
  switch (studio.step) {
    case "engine":
      return () => actions.studio({ t: "choose_engine" });
    case "install":
      if (model.kokoro?.state === "ready") return () => actions.studio({ t: "next" });
      if (install.phase === "manual") return actions.refresh;
      return () => actions.install("kokoro");
    case "pick":
      return () => (model.voice ? actions.studio({ t: "choose_voice", voice: model.voice.id }) : undefined);
    case "hear":
      return () => actions.studio({ t: "use_stt" });
    case "ready":
      return actions.finish;
  }
}

/** Interactive targets keep their own Enter and Space; the studio's keys are for everything else. */
function ownsKey(target: EventTarget, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select")) return true;
  return (key === "Enter" || key === " ") && target.closest("button, a, [role='radio']") !== null;
}

export default function Studio({ model }: { model: VoiceModel }) {
  const { actions, studio } = model;

  const onKey = (phase: "down" | "up") => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || ownsKey(e.target, e.key)) return;
    const act = keyAction(studio.step, e.key, phase);
    if (act === null) return;
    e.preventDefault();
    switch (act) {
      case "choose_engine":
        return actions.studio({ t: "choose_engine" });
      case "back":
        return model.dock.canBack ? actions.studio({ t: "back" }) : undefined;
      case "skip":
        return actions.studio({ t: "skip" });
      case "primary":
        return primary(model)();
      case "toggle_preview":
        return model.voice && model.kokoro?.state === "ready" ? actions.togglePreview(model.voice.id) : undefined;
      case "record_start":
        return model.hear.recording ? undefined : actions.recordStart();
      case "record_stop":
        return model.hear.recording ? actions.recordStop() : undefined;
      case "pick_stt_1":
      case "pick_stt_2": {
        const col = model.columns[act === "pick_stt_1" ? 0 : 1];
        return col?.ready ? actions.studio({ t: "pick_stt", engine: col.id }) : undefined;
      }
    }
  };

  return (
    <div className="vs" tabIndex={-1} onKeyDown={onKey("down")} onKeyUp={onKey("up")} data-step={studio.step}>
      <div className="vs-frame">
        <Rail model={model} />
        <main className="vs-centre">
          <header className="vs-presence">
            <Orb
              ring={studio.done.includes("install") || model.kokoro?.state === "ready" ? 1 : model.install.ring}
              speaking={model.preview.phase === "playing"}
              level={model.meters.level}
            />
            <div className="stack" style={{ gap: 2 }}>
              <h1 className="typo-heading-lg">Athena</h1>
              <span className="typo-caption" aria-live="polite">
                {model.status}
              </span>
            </div>
            <span className="typo-caption vs-push vs-hide-narrow">Her voice, then yours.</span>
          </header>

          <section className="vs-thread" role="log" aria-live="polite" aria-label="The studio">
            <div className="vs-thread__inner">
              {model.receipts.map((r) => (
                <div key={r.step} className="vs-receipt typo-body" data-status={r.status}>
                  <span className="vs-receipt__mark" aria-hidden="true">
                    {r.status === "done" ? "✓" : "–"}
                  </span>
                  <span>{r.text}</span>
                  <button
                    type="button"
                    className="vs-receipt__change typo-label focus-ring"
                    onClick={() => actions.studio({ t: "go", step: r.step })}
                  >
                    change
                  </button>
                </div>
              ))}
              <div className="vs-her" key={`${studio.step}:${model.line}`}>
                <span className="typo-label vs-her__who">Athena</span>
                <p className="typo-body">{model.line}</p>
              </div>
              {studio.step !== "ready" ? (
                <div className="vs-card" key={studio.step} data-step={studio.step}>
                  <div className="vs-card__head">
                    <h2 className="typo-heading">{STEP_LABEL[studio.step]}</h2>
                    <span className="typo-caption vs-push">
                      {STEP_ORDER.indexOf(studio.step) + 1} of {STEP_ORDER.length}
                    </span>
                  </div>
                  <Card model={model} />
                </div>
              ) : (
                <div className="vs-card" key="ready" data-step="ready">
                  <ReadyCard model={model} />
                </div>
              )}
            </div>
          </section>

          <footer className="vs-dock">
            <div className="vs-dock__inner">
              {model.dock.canBack ? (
                <Chip k="B" label="Back" onPress={() => actions.studio({ t: "back" })} />
              ) : null}
              <span className="vs-push" />
              {model.dock.canSkip ? <Chip k="S" label="Skip" onPress={() => actions.studio({ t: "skip" })} /> : null}
              <Chip
                k="Enter"
                label={model.dock.primaryLabel}
                primary
                disabledReason={model.dock.primaryDisabledReason}
                onPress={primary(model)}
              />
            </div>
          </footer>
        </main>
        <StyleCard model={model} />
      </div>
    </div>
  );
}

function Chip({
  k,
  label,
  onPress,
  primary: isPrimary = false,
  disabledReason,
}: {
  k: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabledReason?: string;
}) {
  return (
    <Button variant={isPrimary ? "primary" : "secondary"} size="sm" disabledReason={disabledReason} onClick={onPress}>
      <Kbd>{k}</Kbd>
      {label}
    </Button>
  );
}

// -- the rail ----------------------------------------------------------------------------------

const MARK = { done: "✓", current: "›", skipped: "–", todo: "·" } as const;

function Rail({ model }: { model: VoiceModel }) {
  return (
    <aside className="vs-rail" aria-label="The path">
      <span className="typo-label vs-eyebrow">The studio</span>
      <ol className="vs-path">
        <li className="vs-path__fill" aria-hidden="true" style={{ height: `calc((100% - 24px) * ${model.progress})` }} />
        {model.stages.map((stage) => (
          <li key={stage.id} className="vs-stage" data-status={stage.status}>
            <span className="vs-stage__dot" aria-hidden="true" />
            <span className="typo-title vs-stage__label" aria-current={stage.status === "now" ? "step" : undefined}>
              {stage.label}
            </span>
            {stage.status === "now" && stage.steps.length > 1 ? (
              <ul className="vs-substeps">
                {stage.steps.map((step) => (
                  <li key={step.id} className="typo-caption" data-status={step.status}>
                    <span aria-hidden="true">{MARK[step.status]}</span>
                    {step.status === "done" || step.status === "skipped" ? (
                      <button
                        type="button"
                        className="vs-link focus-ring"
                        onClick={() => model.actions.studio({ t: "go", step: step.id })}
                      >
                        {step.label}
                      </button>
                    ) : (
                      <span>{step.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="vs-rail__foot">
        <Button variant="ghost" size="sm" onClick={() => model.actions.studio({ t: "restart" })}>
          Start over
        </Button>
      </div>
    </aside>
  );
}

// -- the style card ------------------------------------------------------------------------------

function StyleCard({ model }: { model: VoiceModel }) {
  const all = [...model.styleHer, ...model.styleHears];
  const filled = all.filter((l) => l.value !== null).length / all.length;
  return (
    <aside className="vs-rail vs-rail--right" aria-label="Her card">
      <div className="vs-style">
        <div className="vs-style__head">
          <span className="vs-style__seal" style={{ ["--filled" as string]: filled }} aria-hidden="true" />
          <div className="stack" style={{ gap: 0 }}>
            <h2 className="typo-heading">Her card</h2>
            <span className="typo-caption">Writes itself as you decide.</span>
          </div>
        </div>
        <StyleGroup title="Her voice" lines={model.styleHer} model={model} />
        <StyleGroup title="How she hears you" lines={model.styleHears} model={model} />
        <p className="typo-caption vs-style__foot">
          Talk anywhere: hold <Kbd>Ctrl+Shift+Space</Kbd>
        </p>
      </div>
    </aside>
  );
}

function StyleGroup({ title, lines, model }: { title: string; lines: readonly StyleLine[]; model: VoiceModel }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <h3 className="typo-label vs-eyebrow">{title}</h3>
      <ul className="vs-style__lines">
        {lines.map((line) => (
          <li key={line.step + line.label}>
            {line.value === null ? (
              <span className="vs-style__line typo-caption">
                {line.label}: not yet
              </span>
            ) : (
              <button
                type="button"
                className="vs-style__line typo-body focus-ring"
                onClick={() => model.actions.studio({ t: "go", step: line.step })}
              >
                {line.value}
                <span className="typo-label vs-style__change">change</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// -- the cards ----------------------------------------------------------------------------------

function Card({ model }: { model: VoiceModel }) {
  const step: StepId = model.studio.step;
  switch (step) {
    case "engine":
      return <EngineCard model={model} />;
    case "install":
      return <InstallCard model={model} />;
    case "pick":
      return <PickCard model={model} />;
    case "hear":
      return <HearCard model={model} />;
    case "ready":
      return null;
  }
}

function EngineCard({ model }: { model: VoiceModel }) {
  const { kokoro } = model;
  return (
    <div className="stack">
      <div className="vs-opts" role="group" aria-label="Her voice engine">
        <button
          type="button"
          className="vs-opt focus-ring"
          aria-pressed={model.studio.engineChosen}
          onClick={() => model.actions.studio({ t: "choose_engine" })}
        >
          <Kbd>1</Kbd>
          <span className="typo-heading">Kokoro — local, private, about 400 MB</span>
          <span className="typo-label vs-tag">Recommended</span>
          <span className="vs-opt__desc">
            {kokoro ? <EngineState engine={kokoro} /> : <span className="typo-caption">Not reported by the daemon.</span>}
          </span>
        </button>
      </div>
      <p className="typo-caption">
        Kokoro runs on this computer; what she says is never sent anywhere. More engines can join later — the
        flow will not change.
      </p>
    </div>
  );
}

function InstallCard({ model }: { model: VoiceModel }) {
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
}

function PickCard({ model }: { model: VoiceModel }) {
  const { voice, kokoro } = model;
  if (!voice) {
    return <p className="typo-caption">Kokoro lists no voices. Check again once it is installed.</p>;
  }
  return (
    <div className="stack">
      <VoiceTile
        voice={voice}
        preview={model.preview}
        picked={model.studio.voice === voice.id}
        meters={model.meters}
        disabledReason={kokoro?.state === "ready" ? undefined : "Her voice is not installed yet."}
        onToggle={() => model.actions.togglePreview(voice.id)}
      />
      <p className="typo-caption">
        {model.studio.wokeUp ? (
          <>Next, she says: “{model.previewLine}”</>
        ) : (
          <>Her first words will be: “{model.previewLine}”</>
        )}
      </p>
    </div>
  );
}

function HearCard({ model }: { model: VoiceModel }) {
  const { hear, columns, actions } = model;
  const anyReady = columns.some((c) => c.ready);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <HoldToTalk
        recording={hear.recording}
        meters={model.meters}
        disabledReason={anyReady ? undefined : "No listener is ready yet — install a Whisper model or add a key below."}
        onStart={actions.recordStart}
        onStop={actions.recordStop}
      />
      {hear.micError ? (
        <p className="typo-caption vs-error" role="alert">
          {hear.micError}
        </p>
      ) : null}
      <div className="vs-takes">
        {columns.map((col, i) => (
          <div key={col.id} className="vs-take" data-picked={col.picked ? "true" : "false"} data-muted={col.ready ? "false" : "true"}>
            <div className="vs-take__head">
              <StatusDot tone={col.ready ? (col.picked ? "success" : "info") : "neutral"} />
              <span className="typo-heading">{col.name}</span>
              <span className="typo-label vs-tag" data-cloud={col.where === "cloud" ? "true" : "false"}>
                {col.where}
              </span>
              {col.take.ms !== null ? <span className="typo-data vs-push">{col.take.ms} ms</span> : null}
            </div>
            <p className="typo-body vs-take__body">{col.body}</p>
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
        <p className="typo-caption">
          {sttName(model.studio.stt, model.studio.stt === "whisper" ? (model.config?.stt.model ?? null) : null)} is picked.
          Press Enter to keep it.
        </p>
      ) : null}
    </div>
  );
}

/** Whisper's model rail, and the install of a model that is not on disk yet. */
export function WhisperModels({ model }: { model: VoiceModel }) {
  const models = model.whisperModels;
  if (models.length === 0) return null;
  const chosen = model.config?.stt.engine === "whisper" ? model.config.stt.model : null;
  const current = models.find((m) => m.id === chosen) ?? null;
  const installing = model.installComponent === `whisper:${current?.id ?? ""}`;
  return (
    <div className="stack">
      <PillGroup
        ariaLabel="Whisper model"
        value={chosen ?? ""}
        onChange={(id) => model.actions.chooseStt("whisper", id)}
        options={models
          .filter((m) => m.id.endsWith(".en") || m.installed || m.id === chosen)
          .map((m) => ({
            value: m.id,
            label: `${m.id} · ${m.size_mb} MB`,
            hint: m.installed ? "Installed" : "Not installed yet",
          }))}
      />
      {current && !current.installed ? (
        installing && model.whisperInstall.phase !== "completed" ? (
          <InstallBlock
            view={model.whisperInstall}
            home={null}
            sizeMb={current.size_mb}
            refusal={model.installError}
            onInstall={() => model.actions.install(`whisper:${current.id}`)}
            onCheck={model.actions.refresh}
          />
        ) : (
          <span className="row">
            <Button size="sm" variant="secondary" onClick={() => model.actions.install(`whisper:${current.id}`)}>
              Install {current.id}
            </Button>
            <span className="typo-caption">{current.size_mb} MB</span>
          </span>
        )
      ) : null}
    </div>
  );
}

/**
 * The OpenAI key, typed once and sealed by the daemon. The field is a draft until it is saved and
 * is cleared after — the key is never displayed back, not even as dots.
 */
export function KeyField({ model, onDone }: { model: VoiceModel; onDone?: () => void }) {
  const [draft, setDraft] = useState("");
  const save = () => {
    if (!draft.trim()) return;
    model.actions.saveKey(draft.trim());
    setDraft("");
    onDone?.();
  };
  return (
    <div className="stack">
      <span className="row">
        <TextInput
          type="password"
          autoComplete="off"
          value={draft}
          placeholder="sk-..."
          aria-label="OpenAI API key"
          style={{ flex: "1 1 12rem" }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabledReason={model.keyBusy ? "Saving the key..." : draft.trim() ? undefined : "Paste a key first."}
          onClick={save}
        >
          Save key
        </Button>
      </span>
      <span className="typo-caption">Sealed on this machine. Takes go to OpenAI — this one is cloud.</span>
      {model.saveError ? <p className="typo-caption vs-error">{model.saveError}</p> : null}
    </div>
  );
}

function ReadyCard({ model }: { model: VoiceModel }) {
  const her = model.styleHer.find((l) => l.step === "pick")?.value ?? "not chosen";
  const hears = model.styleHears[0]?.value ?? "not chosen";
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="vs-card__head">
        <h2 className="typo-heading">{model.available ? "She is ready" : "Nearly there"}</h2>
      </div>
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
      <p className="typo-caption">
        Hold <Kbd>Ctrl+Shift+Space</Kbd> anywhere to talk to her; let go and she answers.
      </p>
    </div>
  );
}
