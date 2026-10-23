/**
 * The voice pieces the scene shares — ADR 0028 and 0087, README section 3.1.
 *
 * What the studio and the settings both need and the model owns: what Enter does on the current
 * step (one table, `primary`), Whisper's model rail with the install of a model not yet on disk,
 * and the OpenAI key field that is a draft until saved and is never displayed back. Pure: every
 * act is a call on `model.actions`. These were the studio view's exports; the view itself went with
 * the module bar.
 */
import { useState } from "react";

import Button from "@/components/Button";
import PillGroup from "@/components/PillGroup";
import { TextInput } from "@/components/FormField";

import type { Tone } from "@/lib/voice-setup";

import { TONE_COPY, type VoiceModel } from "./model";
import { InstallBlock } from "./parts";

const TONE_OPTIONS: { value: Tone; label: string; hint: string }[] = (["natural", "halo"] as const).map((value) => ({
  value,
  label: TONE_COPY[value].label,
  hint: TONE_COPY[value].line,
}));

/**
 * Her tone (ADR 0138): Natural or Halo, the chosen one's line, and a play button that says the
 * sample line in it through the same preview as her voice. Without the add-on the daemon's plain
 * line is shown and she keeps speaking in her natural tone; the choice stays as it was.
 */
export function ToneControl({ model }: { model: VoiceModel }) {
  const { tone, voice, preview } = model;
  if (!tone) return <span className="typo-caption">This daemon does not offer a tone yet.</span>;
  const mine = voice !== null && preview.voice === voice.id && preview.tone === tone.chosen;
  const playing = mine && preview.phase === "playing";
  const synth = mine && preview.phase === "synth";
  const label = TONE_COPY[tone.chosen].label;
  return (
    <div className="stack">
      <PillGroup ariaLabel="Tone" value={tone.chosen} onChange={(next) => model.actions.chooseTone(next)} options={TONE_OPTIONS} />
      <p className="typo-caption">{TONE_COPY[tone.chosen].line}</p>
      <span className="row">
        <Button
          size="sm"
          variant={playing ? "primary" : "secondary"}
          aria-pressed={playing}
          disabledReason={
            voice === null ? "Kokoro lists no voices until it is installed." : model.kokoro?.state === "ready" ? undefined : "Install Kokoro first."
          }
          onClick={() => (voice ? model.actions.togglePreview(voice.id, tone.chosen) : undefined)}
        >
          {playing ? "Stop" : synth ? "Getting ready..." : `Hear ${label}`}
        </Button>
      </span>
      {tone.note ? (
        <p className="typo-caption" role="status">
          {tone.note}
        </p>
      ) : null}
      {mine && preview.phase === "error" && preview.error ? (
        <p className="typo-caption vs-error" role="alert">
          {preview.error}
        </p>
      ) : null}
    </div>
  );
}

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
    // The button's rule, for Enter too: nothing while a save is in flight, and the draft is kept.
    if (!draft.trim() || model.keyBusy) return;
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
