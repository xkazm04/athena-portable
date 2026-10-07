/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice surface.
 *
 * A pure function of `VoiceModel`, in two moods: the **studio** (`studio.tsx`) until the person
 * has finished it once, then **settings** — two columns, Output (her voice) and Input (how she
 * hears you), each row a fact in a sentence and the control that changes it.
 *
 * Before either mood there are the states every surface owes: the daemon not running (a
 * `ProblemNote`, because nothing about voice can be known), the config not answered yet, the
 * config refused (a `ProblemNote` with Ask again), and a config with no engines at all (an
 * `EmptyState`: an answer, not a failure). The header renders outside all of them.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Facts, { Fact } from "@/components/Facts";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import StatusDot from "@/components/StatusDot";
import type { SttEngineId } from "@/lib/voice-setup";

import { sttName, type VoiceModel } from "./model";
import { EngineState, HoldToTalk, InstallBlock, VoiceTile } from "./parts";
import Studio, { KeyField, WhisperModels } from "./studio";

import "./voice.css";

export default function VoiceView({ model }: { model: VoiceModel }) {
  const gate = gateFor(model);
  if (gate) {
    return (
      <PageShell>
        <Header model={model} />
        {gate}
      </PageShell>
    );
  }
  if (model.mode === "studio") {
    return (
      <PageShell fill>
        <Studio model={model} />
      </PageShell>
    );
  }
  return <Settings model={model} />;
}

function Header({ model }: { model: VoiceModel }) {
  const settled = model.config !== null && model.daemon === "ready";
  return (
    <PageHeader
      eyebrow="Voice"
      title="How Athena sounds and hears"
      caption="Her voice, how she hears you, and whether both are ready."
      meta={
        settled ? (
          <Badge tone={model.available ? "success" : "warning"} title={model.reason || undefined}>
            {model.available ? "voice ready" : "voice off"}
          </Badge>
        ) : null
      }
      action={
        model.mode === "settings" && settled ? (
          <Button variant="ghost" size="sm" onClick={model.actions.reopenStudio}>
            Run the studio again
          </Button>
        ) : null
      }
    />
  );
}

/** The body for every state that is not "the config answered with engines", or `null`. */
function gateFor(model: VoiceModel): ReactNode {
  if (model.daemon === "offline") {
    return (
      <ProblemNote
        title="Athena's daemon is not running, so her voice cannot be set up yet."
        reason={model.problem ?? "daemon_offline"}
        detail="Voice is chosen, installed and tested through the daemon. This page fills in when it answers."
      />
    );
  }
  if (model.daemon === "starting") {
    return <p className="typo-caption">Athena is starting. Her voice setup appears when the daemon answers.</p>;
  }
  if (model.problem && model.config === null) {
    return (
      <ProblemNote
        title="Athena could not read her voice setup."
        reason={model.problem}
        onRetry={model.actions.refresh}
      />
    );
  }
  if (model.loading || model.config === null) {
    return <p className="typo-caption">Reading her voice setup...</p>;
  }
  if (model.empty) {
    return (
      <EmptyState
        glyph="~"
        title="No voice engines were offered"
        line="The daemon answered with none. A daemon built with voice lists Kokoro, Whisper and OpenAI here."
        action={
          <span>
            <Button size="sm" variant="secondary" onClick={model.actions.refresh}>
              Check again
            </Button>
          </span>
        }
      />
    );
  }
  return null;
}

// -- settings ------------------------------------------------------------------------------------

function Settings({ model }: { model: VoiceModel }) {
  return (
    <PageShell>
      <Header model={model} />
      {!model.available && model.reason ? (
        <p className="row row--baseline typo-body" role="status">
          <StatusDot tone="warning" />
          {model.reason}
        </p>
      ) : null}
      <div className="vs-scope">
        <div className="vs-settings">
          <Output model={model} />
          <Input model={model} />
        </div>
      </div>
    </PageShell>
  );
}

function Row({ label, fact, children }: { label: string; fact: string; children: ReactNode }) {
  return (
    <div className="vs-row">
      <div className="stack" style={{ gap: 2 }}>
        <span className="typo-title">{label}</span>
        <p className="typo-caption">{fact}</p>
      </div>
      <div className="stack">{children}</div>
    </div>
  );
}

function Output({ model }: { model: VoiceModel }) {
  const { kokoro, voice } = model;
  const kokoroInstalling = model.installComponent === "kokoro" && model.install.busy;
  return (
    <SectionCard title="Output" note="Her voice">
      <div className="vs-rows">
        <Row
          label="Engine"
          fact="Kokoro speaks on this computer. Nothing she says is sent anywhere."
        >
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
          <span className="row">
            <Button size="sm" variant="ghost" onClick={model.actions.refresh}>
              Check again
            </Button>
          </span>
        </Row>
        <Row label="Voice" fact="The voice she speaks every reply in.">
          {voice ? (
            <VoiceTile
              voice={voice}
              preview={model.preview}
              picked={model.config?.tts.voice === voice.id}
              meters={model.meters}
              kbd={false}
              disabledReason={kokoro?.state === "ready" ? undefined : "Install Kokoro first."}
              onToggle={() => model.actions.togglePreview(voice.id)}
            />
          ) : (
            <span className="typo-caption">Kokoro lists no voices until it is installed.</span>
          )}
        </Row>
        <Row label="Engine home" fact="Shared with Personas: one install serves both apps.">
          <code className="typo-code vs-home">{model.config?.home}</code>
        </Row>
      </div>
    </SectionCard>
  );
}

const STT_HINT: Record<SttEngineId, string> = {
  whisper: "Whisper listens on this computer.",
  openai: "OpenAI listens in the cloud: each take is sent to OpenAI.",
};

function Input({ model }: { model: VoiceModel }) {
  const engine = model.config?.stt.engine ?? "whisper";
  const whisperModel = model.config?.stt.model ?? null;
  const lastWhisper =
    whisperModel ?? model.whisperModels.find((m) => m.installed)?.id ?? model.whisperModels[0]?.id ?? "base.en";
  const take = model.hear.takes[engine];
  return (
    <SectionCard title="Input" note="How she hears you">
      <div className="vs-rows">
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
            <ModelList model={model} />
            <WhisperModels model={model} />
          </Row>
        ) : null}
        <Row label="OpenAI key" fact="Sealed on this machine and never shown again.">
          <OpenAiKey model={model} />
        </Row>
        <Row label="Test" fact={`One take through ${sttName(engine, engine === "whisper" ? whisperModel : null)}.`}>
          <HoldToTalk
            recording={model.hear.recording}
            meters={model.meters}
            keys
            disabledReason={
              model.columns.find((c) => c.id === engine)?.ready
                ? undefined
                : `${sttName(engine, engine === "whisper" ? whisperModel : null)} is not ready yet.`
            }
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
      </div>
    </SectionCard>
  );
}

/** Every Whisper model with its standing, so "which are on disk" is a list and not a hover. */
function ModelList({ model }: { model: VoiceModel }) {
  return (
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
  );
}

function OpenAiKey({ model }: { model: VoiceModel }) {
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
