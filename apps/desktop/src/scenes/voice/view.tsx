/**
 * The Voice depth — README section 3.1 and 3.5, ADR 0028, 0087 and 0090.
 *
 * Three levels of one view. The root is a field showing the two places and the daemon's standing:
 * hover or focus a place and its name takes the centre of the frame. `voice/studio` is the studio
 * drawn as an act (`studio.tsx`), `voice/settings` the two instruments (`settings.tsx`). Before
 * either place there are the states every surface owes (`parts.tsx` `Gate`): the daemon not
 * running, starting, the config refused, loading, or empty. An unknown item is said, never drawn.
 *
 * A pure function of `{ model, path, go }`, with only the view's own state (what is hovered). The
 * model's two moves that end a place (finish the studio, reopen it) also move the person: the
 * wrapper below adds the dive to the model's own action and nothing else.
 */
import { useMemo, useState } from "react";

import VoiceArt from "@/art/voice";
import type { AvatarId } from "@/avatar/types";
import type { Pose } from "@/bell/pose";
import type { Path } from "@/depth/model";
import { STEP_LABEL, STEP_ORDER, type VoiceModel } from "@/modules/voice/model";
import { Kbd } from "@/modules/voice/parts";

import { Her, useMainFace } from "./face";
import { Gate, HOTKEY, gateKind } from "./parts";
import SettingsAct from "./settings";
import StudioAct from "./studio";

import "@/modules/voice/voice.css";
import "./voice.css";

export const STUDIO: Path = { root: "voice", item: "studio" };
export const SETTINGS: Path = { root: "voice", item: "settings" };

export interface VoiceSceneProps {
  model: VoiceModel;
  path: Path;
  go: (to: Path) => void;
  /** How she appears (the `avatar` setting); the halo when not given. */
  avatar?: AvatarId;
  /** Choose how she appears, from settings: writes the `avatar` setting. */
  onAvatar?: (avatar: AvatarId) => void;
}

const NO_CHOICE = () => {};

/** Finishing the studio lands in settings; reopening it lands in the studio. Nothing else changes. */
export function withMoves(model: VoiceModel, go: (to: Path) => void): VoiceModel {
  return {
    ...model,
    actions: {
      ...model.actions,
      finish: () => {
        // Settings only once the row is stored: a refused write keeps the person in the studio,
        // where the reason is shown. A model that cannot say (a fixture) moves at once.
        const stored = model.actions.finish();
        if (stored instanceof Promise) void stored.then((ok) => ok && go(SETTINGS));
        else go(SETTINGS);
      },
      reopenStudio: () => {
        model.actions.reopenStudio();
        go(STUDIO);
      },
    },
  };
}

export default function VoiceScene({ model: raw, path, go, avatar = "halo", onAvatar = NO_CHOICE }: VoiceSceneProps) {
  const model = useMemo(() => withMoves(raw, go), [raw, go]);
  const gate = gateKind(model);

  if (path.item === undefined) return <Field model={model} gate={gate} go={go} avatar={avatar} />;

  if (path.item !== "studio" && path.item !== "settings") {
    return (
      <div className="vsc vsc--gate">
        <header className="vsc-bar">
          <div>
            <p className="vsc-eyebrow">Voice</p>
            <h1 className="vsc-title vsc-title--sm">There is no such place under Voice.</h1>
          </div>
        </header>
        <p className="typo-body">
          Voice has two places, the studio and settings.{" "}
          <button type="button" className="vsc-link focus-ring" onClick={() => go({ root: "voice" })}>
            Back to Voice
          </button>
        </p>
      </div>
    );
  }

  if (gate !== null) {
    return (
      <div className="vsc vsc--gate">
        <header className="vsc-bar">
          <div>
            <p className="vsc-eyebrow">Voice · {path.item === "studio" ? "Studio" : "Settings"}</p>
            <h1 className="vsc-title vsc-title--sm">How Athena sounds and hears</h1>
          </div>
        </header>
        <Gate kind={gate} model={model} />
      </div>
    );
  }
  return path.item === "studio" ? (
    <StudioAct model={model} avatar={avatar} />
  ) : (
    <SettingsAct model={model} avatar={avatar} onAvatar={onAvatar} />
  );
}

// -- the field --------------------------------------------------------------------------------

/** Her pose at the root: only what the model can back (speaking is not a pose, ADR 0026). */
function poseOf(model: VoiceModel): Pose {
  if (model.hear.recording) return "hearing";
  return model.install.busy || model.preview.phase === "synth" || model.preview.phase === "playing" ? "working" : "resting";
}

interface Place {
  id: "studio" | "settings";
  name: string;
  hint: string;
  stat: string;
  art: "studio" | "settings";
  to: Path;
}

function placesOf(model: VoiceModel): Place[] {
  const n = STEP_ORDER.indexOf(model.studio.step) + 1;
  const done = model.mode === "settings";
  const output = model.kokoro ? (model.kokoro.state === "ready" ? "installed" : "needs install") : "unknown";
  const chosen = model.config?.stt.engine ?? "whisper";
  const input = model.columns.find((c) => c.id === chosen)?.ready ? "ready" : "not ready";
  return [
    {
      id: "studio",
      name: "Studio",
      hint: "Walk through her voice and then yours: engine, install, pick, hear, ready. One step at a time, and you can go back.",
      stat: done ? "finished — walk it again" : `step ${n} of ${STEP_ORDER.length}: ${STEP_LABEL[model.studio.step]}`,
      art: "studio",
      to: STUDIO,
    },
    {
      id: "settings",
      name: "Settings",
      hint: "Her output and your input side by side: the engines, the voice, Whisper's models, the OpenAI key and a test take.",
      stat: model.config ? `output ${output} · input ${input}` : "waiting for the daemon",
      art: "settings",
      to: SETTINGS,
    },
  ];
}

function standing(model: VoiceModel, gate: ReturnType<typeof gateKind>): { word: string; line: string } {
  switch (gate) {
    case "offline":
      return { word: "Her voice is out of reach.", line: "Nothing about voice can be known until the daemon answers." };
    case "starting":
      return { word: "She is starting.", line: "Athena is starting. Her voice setup appears when the daemon answers." };
    case "problem":
      return { word: "Her voice is unknown.", line: "Her voice setup could not be read; the reason is below." };
    case "loading":
      return { word: "Reading her voice.", line: "Reading her voice setup..." };
    case "empty":
      return { word: "No engines offered.", line: "The daemon answered with none." };
    case null:
      return model.available
        ? { word: "Her voice is ready.", line: `Hold ${HOTKEY} anywhere to talk to her; let go and she answers.` }
        : { word: "Her voice is off for now.", line: model.reason || "Voice stays off until both engines are ready." };
  }
}

function Field({
  model,
  gate,
  go,
  avatar,
}: {
  model: VoiceModel;
  gate: ReturnType<typeof gateKind>;
  go: (to: Path) => void;
  avatar: AvatarId;
}) {
  const [focused, setFocused] = useState<Place["id"] | null>(null);
  const face = useMainFace();
  const places = placesOf(model);
  const place = places.find((p) => p.id === focused) ?? null;
  const now = standing(model, gate);
  const lean = focused === null ? 0 : focused === "studio" ? -0.6 : 0.6;
  return (
    <div className="vsc vsc--field" data-standing={gate ?? (model.available ? "ready" : "off")}>
      <div className="vsc-field__bell">
        <Her avatar={avatar} pose={poseOf(model)} reach={[]} lean={lean} size={400} source={face} />
      </div>

      <div className="vsc-field__words">
        <p className="vsc-eyebrow">{place ? "Go to" : "Voice"}</p>
        <h1 className="vsc-marquee">{place ? place.name : now.word}</h1>
        <p className="vsc-lead" aria-live="polite">
          {place ? place.hint : now.line}
        </p>

        {gate !== null && gate !== "starting" && gate !== "loading" ? <Gate kind={gate} model={model} /> : null}

        <ul className="vsc-places" aria-label="Places under Voice">
          {places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="vsc-place focus-ring"
                data-focused={focused === p.id}
                onMouseEnter={() => setFocused(p.id)}
                onMouseLeave={() => setFocused((f) => (f === p.id ? null : f))}
                onFocus={() => setFocused(p.id)}
                onBlur={() => setFocused((f) => (f === p.id ? null : f))}
                onClick={() => go(p.to)}
              >
                <VoiceArt kind={p.art} size={132} />
                <span className="vsc-place__name">{p.name}</span>
                <span className="vsc-place__stat">{p.stat}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="typo-caption">
          Talk anywhere: hold <Kbd>{HOTKEY}</Kbd>
        </p>
      </div>
    </div>
  );
}
