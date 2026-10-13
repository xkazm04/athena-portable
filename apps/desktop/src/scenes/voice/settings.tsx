/**
 * Voice settings, drawn as two instruments — README section 3.1, ADR 0028, 0087 and 0089.
 *
 * Output (her voice: the engine and its install, the voice and a play button, where the engine
 * lives) on the left, Input (how she hears you: the listener, Whisper's models, the OpenAI key, a
 * test take) on the right. Every row is a fact in a sentence and the control that changes it, as the
 * module's settings were. The key is typed once and never shown back; Replace and Remove are
 * there, and Keep the stored key cancels a replacement.
 *
 * Pure, over the same model as the studio. The test take is the one place a take records here, and
 * its meter is the module's `HoldToTalk` (one frame loop while it records).
 */
import { useState, type ReactNode } from "react";

import VoiceArt from "@/art/voice";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import PillGroup from "@/components/PillGroup";
import StatusDot from "@/components/StatusDot";
import type { SttEngineId } from "@/lib/voice-setup";
import { sttName, voiceMeta, type VoiceModel } from "@/modules/voice/model";
import { EngineState, HoldToTalk, InstallBlock, Kbd } from "@/modules/voice/parts";
import { KeyField, WhisperModels } from "@/modules/voice/pieces";
import { Waveform } from "@/modules/voice/waveform";

import { HOTKEY } from "./parts";

const STT_HINT: Record<SttEngineId, string> = {
  whisper: "Whisper listens on this computer.",
  openai: "OpenAI listens in the cloud: each take is sent to OpenAI.",
};

export default function SettingsAct({ model }: { model: VoiceModel }) {
  const { actions } = model;
  return (
    <div className="vsc vsc--settings vs-scope">
      <header className="vsc-bar">
        <div>
          <p className="vsc-eyebrow">Voice · Settings</p>
          <h1 className="vsc-title vsc-title--sm">How she sounds, and how she hears you.</h1>
          <p className="typo-caption vsc-hotkey">
            Talk anywhere: hold <Kbd>{HOTKEY}</Kbd>. Let go and she answers.
          </p>
        </div>
        <div className="vsc-bar__acts">
          <Badge tone={model.available ? "success" : "warning"} title={model.reason || undefined}>
            {model.available ? "voice ready" : "voice off"}
          </Badge>
          <Button size="sm" variant="secondary" title="Ask the daemon for her voice setup again" onClick={actions.refresh}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={actions.reopenStudio}>
            Reopen studio
          </Button>
        </div>
      </header>

      {!model.available && model.reason ? (
        <p className="row row--baseline typo-body" role="status">
          <StatusDot tone="warning" />
          {model.reason}
        </p>
      ) : null}

      <div className="vsc-instruments">
        <Output model={model} />
        <Input model={model} />
      </div>
    </div>
  );
}

function Panel({ art, title, note, children }: { art: ReactNode; title: string; note: string; children: ReactNode }) {
  return (
    <section className="vsc-panel" aria-label={title}>
      <header className="vsc-panel__head">
        {art}
        <div className="stack" style={{ gap: 0 }}>
          <h2 className="typo-heading-lg">{title}</h2>
          <span className="typo-caption">{note}</span>
        </div>
      </header>
      <div className="vsc-rows">{children}</div>
    </section>
  );
}

function Row({ label, fact, children }: { label: string; fact: string; children: ReactNode }) {
  return (
    <div className="vsc-row">
      <div className="stack" style={{ gap: 2 }}>
        <span className="typo-title">{label}</span>
        <p className="typo-caption">{fact}</p>
      </div>
      <div className="stack">{children}</div>
    </div>
  );
}

function Output({ model }: { model: VoiceModel }) {
  const { kokoro, voice, preview } = model;
  const kokoroInstalling = model.installComponent === "kokoro" && model.install.busy;
  const mine = voice !== null && preview.voice === voice.id;
  const playing = mine && preview.phase === "playing";
  const synth = mine && preview.phase === "synth";
  return (
    <Panel art={<VoiceArt kind="kokoro" size={92} speaking={playing} />} title="Output" note="Her voice">
      <Row label="Engine" fact="Kokoro speaks on this computer. Nothing she says is sent anywhere.">
        {kokoro ? <EngineState engine={kokoro} /> : <span className="typo-caption">Not reported by the daemon.</span>}
        {kokoro && (kokoro.state !== "ready" || kokoroInstalling) ? (
          <InstallBlock
            view={model.install}
            home={model.config?.home ?? null}
            sizeMb={kokoro.size_mb}
            refusal={model.installError}
            onInstall={() => model.actions.install("kokoro")}
            onCheck={model.actions.refresh}
          />
        ) : null}
      </Row>
      <Row label="Voice" fact="The voice she speaks every reply in.">
        {voice ? (
          <div className="vsc-voice" data-playing={playing ? "true" : "false"} data-picked="true">
            <div className="vsc-voice__head">
              <h3 className="typo-heading">{voice.name}</h3>
              {model.config?.tts.voice === voice.id ? <span className="typo-label vs-tag">Her voice</span> : null}
              <span className="typo-caption vs-push">{voiceMeta(voice)}</span>
            </div>
            {voice.blurb ? <p className="typo-caption">{voice.blurb}</p> : null}
            <span className="row">
              <Button
                size="sm"
                variant={playing ? "primary" : "secondary"}
                aria-pressed={playing}
                disabledReason={kokoro?.state === "ready" ? undefined : "Install Kokoro first."}
                onClick={() => model.actions.togglePreview(voice.id)}
              >
                {playing ? "Stop" : synth ? "Getting ready..." : "Play"}
              </Button>
              <Waveform active={playing} read={model.meters.spectrum} />
            </span>
            {mine && preview.phase === "error" && preview.error ? (
              <p className="typo-caption vs-error" role="alert">
                {preview.error}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="typo-caption">Kokoro lists no voices until it is installed.</span>
        )}
      </Row>
      <Row label="Engine home" fact="Shared with Personas: one install serves both apps.">
        <code className="typo-code vs-home">{model.config?.home}</code>
      </Row>
    </Panel>
  );
}

function Input({ model }: { model: VoiceModel }) {
  const engine = model.config?.stt.engine ?? "whisper";
  const whisperModel = model.config?.stt.model ?? null;
  const lastWhisper =
    whisperModel ?? model.whisperModels.find((m) => m.installed)?.id ?? model.whisperModels[0]?.id ?? "base.en";
  const take = model.hear.takes[engine];
  const name = sttName(engine, engine === "whisper" ? whisperModel : null);
  return (
    <Panel art={<VoiceArt kind={engine === "openai" ? "openai" : "whisper"} size={92} />} title="Input" note="How she hears you">
      <Row label="Listener" fact={STT_HINT[engine]}>
        <PillGroup
          ariaLabel="Listener"
          value={engine}
          onChange={(next) => model.actions.chooseStt(next, next === "whisper" ? lastWhisper : null)}
          options={[
            { value: "whisper", label: "Whisper · local", hint: STT_HINT.whisper },
            { value: "openai", label: "OpenAI · cloud", hint: STT_HINT.openai },
          ]}
        />
        {model.saveError ? <p className="typo-caption vs-error">{model.saveError}</p> : null}
      </Row>
      {engine === "whisper" && model.whisper ? (
        <Row label="Whisper model" fact="Larger hears better and starts slower.">
          <EngineState engine={model.whisper} />
          <Facts layout="inline">
            {model.whisperModels.map((m) => (
              <Fact key={m.id} label={`${m.id} · ${m.size_mb} MB`}>
                <span className="row row--baseline">
                  <StatusDot tone={m.installed ? "success" : "neutral"} />
                  {m.installed ? "installed" : "not installed"}
                </span>
              </Fact>
            ))}
          </Facts>
          <WhisperModels model={model} />
        </Row>
      ) : null}
      <Row label="OpenAI key" fact="Sealed on this machine and never shown again.">
        <OpenAiKey model={model} />
      </Row>
      <Row label="Test take" fact={`One take through ${name}.`}>
        <HoldToTalk
          recording={model.hear.recording}
          meters={model.meters}
          keys
          disabledReason={model.columns.find((c) => c.id === engine)?.ready ? undefined : `${name} is not ready yet.`}
          onStart={model.actions.recordStart}
          onStop={model.actions.recordStop}
        />
        {model.hear.micError ? <p className="typo-caption vs-error">{model.hear.micError}</p> : null}
        {take && take.state !== "idle" ? (
          <p className="typo-body">
            {take.state === "pending"
              ? "Writing it down..."
              : take.state === "failed"
                ? take.error
                : `“${take.text || "(heard nothing)"}”`}
            {take.ms !== null ? <span className="typo-data muted"> · {take.ms} ms</span> : null}
          </p>
        ) : null}
      </Row>
    </Panel>
  );
}

/**
 * The key's three faces: stored (Replace, Remove), being replaced (the field and Keep the stored
 * key) and absent (the field). Nothing here ever holds a stored key; `KeyField` holds only a draft.
 */
export function OpenAiKey({ model }: { model: VoiceModel }) {
  const [replacing, setReplacing] = useState(false);
  const openai = model.openai;
  if (!openai) return <span className="typo-caption">Not reported by the daemon.</span>;
  // Broken means a key is stored and was refused: it is replaced or removed, not typed over blind.
  const stored = openai.state !== "absent";
  if (stored && !replacing) {
    return (
      <div className="stack">
        <EngineState engine={openai} />
        <span className="row">
          <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabledReason={model.keyBusy ? "Removing the key..." : undefined}
            onClick={model.actions.removeKey}
          >
            Remove
          </Button>
        </span>
      </div>
    );
  }
  return (
    <div className="stack">
      {openai.state !== "ready" ? <EngineState engine={openai} /> : null}
      <KeyField model={model} onDone={() => setReplacing(false)} />
      {replacing ? (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => setReplacing(false)}>
            Keep the stored key
          </Button>
        </span>
      ) : null}
    </div>
  );
}
