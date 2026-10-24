/**
 * The Mind depth — README section 3.1 and 3.5, ADR 0029, 0085 and 0087.
 *
 * What Setup was after the first act: the engine she thinks with, the brain she remembers in, how
 * she looks, where it all lives and her microphone. A field of five instruments (each drawn, each
 * saying in one line how it stands) and a level for each where the thing is changed, tested and
 * previewed. A pure function of the Setup module's own view-model, so the facts, the engine's
 * remedy, the failure to start, the restart notice and every sentence are the module's, verbatim;
 * nothing stores a verdict it could have read.
 *
 * "Page" and "Voice", which were tiles of the old list, are not instruments here: the page is the
 * Apps depth and the voice is the Voice depth, and the field says so and links there.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import PillGroup from "@/components/PillGroup";
import type { Tone } from "@/components/StatusDot";
import ProblemNote from "@/components/ProblemNote";
import InstrumentArt, { type Instrument } from "@/art/mind";
import type { Path } from "@/depth/model";
import { engineLabel } from "@/lib/engines";
import { MOTION_CHOICES } from "@/lib/motion";
import type { SetupModel } from "@/modules/setup/model";
import { brainFact, engineFact, micFact, type Standing } from "@/modules/setup/readiness";
import EngineSection, { RestartNoticeBar } from "@/scenes/shared/EngineSection";
import { THEME_CHOICES, TYPE_SCALES } from "@/stores/settings";

import DevicesLevel, { type DevicesModel } from "./devices";
import "./mind.css";
import {
  THEME_HINTS,
  TYPE_SCALE_HINTS,
  ThemePreview,
  engineSentence,
  micSentence,
  pageSentence,
  voiceSentence,
} from "./shared";

const NAME: Record<Instrument, string> = {
  engine: "Engine",
  brain: "Brain",
  look: "Look",
  data: "Data",
  mic: "Microphone",
  devices: "Devices",
};

const STANDING_WORD: Record<Standing, string> = {
  done: "set",
  todo: "not yet",
  missing: "needs you",
  unknown: "checking",
};

/** The hue beside the word: set is good news, needs-you is a warning, and "not yet" is no state at all. */
const STANDING_TONE: Record<Standing, Tone> = {
  done: "success",
  todo: "neutral",
  missing: "warning",
  unknown: "pending",
};

const MOTION_HINTS: Record<(typeof MOTION_CHOICES)[number], string> = {
  system: "Follow the operating system's setting.",
  calm: "Moves land at once; nothing drifts, floats or ripples.",
  full: "Keep the motion, whatever the system asks.",
};

const INSTRUMENTS: readonly Instrument[] = ["engine", "brain", "look", "data", "mic", "devices"];

export interface MindProps {
  model: SetupModel;
  path: Path;
  go: (to: Path) => void;
  /** The Devices level's model (ADR 0140); `null` where nothing mirrors the devices yet. */
  devices?: DevicesModel | null;
}

const item = (i: Instrument): Path => ({ root: "mind", item: i });

export default function MindView({ model, path, go, devices = null }: MindProps) {
  const level = path.item as Instrument | undefined;
  if (level === undefined) return <Field model={model} go={go} />;
  if (!INSTRUMENTS.includes(level)) return <Missing name={level} go={go} />;
  return <Level model={model} which={level} go={go} devices={devices} />;
}

/** One line of how an instrument stands, in the module's own words. */
function lineOf(model: SetupModel, which: Instrument): { word: string | null; tone: Tone; line: string } {
  switch (which) {
    case "engine":
      return {
        word: STANDING_WORD[engineFact(model).standing],
        tone: STANDING_TONE[engineFact(model).standing],
        line: engineSentence(model),
      };
    case "brain":
      return {
        word: STANDING_WORD[brainFact(model).standing],
        tone: STANDING_TONE[brainFact(model).standing],
        line: model.brainPath ? "Episodes, facts and playbooks are written to a folder of your own." : "Episodes go to Athena's own folder.",
      };
    case "look":
      return { word: `${model.theme} theme`, tone: "neutral", line: `${THEME_HINTS[model.theme]} Text: ${model.typeScale}. Motion: ${model.motion}.` };
    case "data":
      return { word: model.storePath ? "local" : null, tone: "neutral", line: "One SQLite file holds this machine's Athena." };
    case "mic":
      return {
        word: STANDING_WORD[micFact(model).standing],
        tone: STANDING_TONE[micFact(model).standing],
        line: micSentence(model),
      };
    case "devices":
      return { word: null, tone: "neutral", line: "Your other computers and your phone, as one Athena." };
  }
}

function Field({ model, go }: { model: SetupModel; go: (to: Path) => void }) {
  const [focused, setFocused] = useState<Instrument | null>(null);
  const shown = focused ? lineOf(model, focused) : null;
  return (
    <div className="mind mind--field">
      <header className="mind__head">
        <p className="mind__eyebrow">{focused ? (shown?.word ?? "Mind") : "Mind"}</p>
        <h1 className="mind__marquee">{focused ? NAME[focused] : "How Athena is set up"}</h1>
        <p className="mind__line" aria-live="polite">
          {shown ? shown.line : "The engine she thinks with, how she looks, and where it all lives."}
        </p>
      </header>

      {model.problem ? (
        <ProblemNote
          title="Athena could not check which engines are installed."
          reason={model.problem}
          detail="The names below are all this page can say until a check goes through. Press Check again."
          onRetry={model.actions.checkEngines}
          retryLabel={model.checking ? "Checking…" : "Check again"}
        />
      ) : null}
      {model.startFailure ? (
        <ProblemNote
          title={model.startFailure.title}
          reason={model.startFailure.reason}
          tone="error"
          onRetry={model.actions.restart}
          retryLabel={model.startFailure.actionLabel}
        />
      ) : null}
      <RestartNoticeBar model={model} />

      <ul className="mind__instruments" aria-label="Settings">
        {INSTRUMENTS.map((which) => {
          const { word, tone, line } = lineOf(model, which);
          return (
            <li key={which}>
              <button
                type="button"
                className="mind__instrument focus-ring"
                data-focused={focused === which}
                title={line}
                onMouseEnter={() => setFocused(which)}
                onMouseLeave={() => setFocused((f) => (f === which ? null : f))}
                onFocus={() => setFocused(which)}
                onBlur={() => setFocused((f) => (f === which ? null : f))}
                onClick={() => go(item(which))}
              >
                <InstrumentArt item={which} size={104} />
                <span className="mind__instrument-name">{NAME[which]}</span>
                {word && <Badge tone={tone}>{word}</Badge>}
              </button>
            </li>
          );
        })}
      </ul>

      <section className="mind__elsewhere" aria-label="Set up elsewhere">
        <div>
          <h2>Apps</h2>
          <p>{pageSentence(model)}</p>
          <Button size="sm" variant="secondary" onClick={() => go({ root: "apps" })}>
            Go to Apps
          </Button>
        </div>
        <div>
          <h2>Voice</h2>
          <p>{voiceSentence(model)}</p>
          <Button size="sm" variant="secondary" onClick={() => go({ root: "voice" })}>
            Go to Voice
          </Button>
        </div>
        <div>
          <h2>The welcome</h2>
          <p>Read the first act again. Nothing already set is changed.</p>
          <Button size="sm" variant="ghost" onClick={model.actions.reopenOnboarding}>
            Show the welcome again
          </Button>
        </div>
      </section>
    </div>
  );
}

function Level({
  model,
  which,
  go,
  devices,
}: {
  model: SetupModel;
  which: Instrument;
  go: (to: Path) => void;
  devices: DevicesModel | null;
}) {
  const { word, line } = lineOf(model, which);
  return (
    <div className="mind mind--level">
      <div className="mind__art">
        <InstrumentArt item={which} size={220} />
      </div>
      <div className="mind__body">
        <p className="mind__eyebrow">{word ?? "Mind"}</p>
        <h1 className="mind__marquee mind__marquee--level">{NAME[which]}</h1>
        <p className="mind__line">{line}</p>
        {which === "engine" && <EngineSection model={model} />}
        {which === "brain" && <Brain model={model} />}
        {which === "look" && <Look model={model} />}
        {which === "data" && <Data model={model} />}
        {which === "mic" && <Mic model={model} />}
        {which === "devices" &&
          (devices ? (
            <DevicesLevel model={devices} />
          ) : (
            <p className="typo-caption">The devices are read once Athena is running.</p>
          ))}
        <Button variant="ghost" size="sm" onClick={() => go({ root: "mind" })}>
          Back to all settings
        </Button>
      </div>
    </div>
  );
}

function Look({ model }: { model: SetupModel }) {
  return (
    <>
      <section className="mind__section" aria-labelledby="mind-theme">
        <h2 id="mind-theme">Theme</h2>
        <PillGroup
          ariaLabel="Theme"
          value={model.theme}
          onChange={model.actions.setTheme}
          options={THEME_CHOICES.map((choice) => ({ value: choice, label: choice, hint: THEME_HINTS[choice] }))}
        />
        <Refused what="The theme" reason={model.refusals.theme} />
      </section>
      <section className="mind__section" aria-labelledby="mind-text">
        <h2 id="mind-text">Text size</h2>
        <PillGroup
          ariaLabel="Text size"
          value={model.typeScale}
          onChange={model.actions.setTypeScale}
          options={TYPE_SCALES.map((scale) => ({ value: scale, label: scale, hint: TYPE_SCALE_HINTS[scale] }))}
        />
        <Refused what="The text size" reason={model.refusals.typeScale} />
      </section>
      <section className="mind__section" aria-labelledby="mind-motion">
        <h2 id="mind-motion">Motion</h2>
        <PillGroup
          ariaLabel="Motion"
          value={model.motion}
          onChange={model.actions.setMotion}
          options={MOTION_CHOICES.map((choice) => ({ value: choice, label: choice, hint: MOTION_HINTS[choice] }))}
        />
        <Refused what="The motion setting" reason={model.refusals.motion} />
      </section>
      <section className="mind__section" aria-labelledby="mind-previews">
        <h2 id="mind-previews">What each one looks like</h2>
        <div className="theme-previews">
          <ThemePreview theme="light" chosen={model.theme === "light"} />
          <ThemePreview theme="dark" chosen={model.theme === "dark"} />
        </div>
        <p className="typo-caption">System follows the operating system and switches when it does.</p>
      </section>
    </>
  );
}

/**
 * A path, committed on Enter or the button. The field is a draft until it is committed, so a
 * half-typed directory is never written: the store is read by the daemon at start-up, and a path
 * that exists for three keystrokes is a path Athena would have tried to use.
 */
function Brain({ model }: { model: SetupModel }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? model.brainPath;
  // One rule for Enter and the button: what would be written is the trimmed draft, and only a
  // path that differs from the stored one is written. Once written it is no longer a draft.
  const typed = draft === null ? null : draft.trim();
  const dirty = typed !== null && typed !== model.brainPath;
  const commit = () => {
    if (typed === null || !dirty) return;
    model.actions.setBrainPath(typed);
    setDraft(null);
  };
  return (
    <section className="mind__section" aria-labelledby="mind-brain">
      <h2 id="mind-brain">Where she remembers</h2>
      <div className="mind__row">
        <input
          className="mind__input focus-ring"
          value={value}
          placeholder="Athena's own folder"
          aria-label="Brain directory"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        <Button
          size="sm"
          variant={dirty ? "primary" : "secondary"}
          disabledReason={dirty ? undefined : "Nothing has been typed that is not stored."}
          onClick={commit}
        >
          Use this
        </Button>
      </div>
      <Refused what="The brain directory" reason={model.refusals.brainPath} />
      <p className="typo-caption">Memory is markdown on disk; copy the folder and her memory goes with it.</p>
    </section>
  );
}

/** A refused write, beside the control that made it: the store's words, and the stored row is back. */
function Refused({ what, reason }: { what: string; reason: string | undefined }) {
  if (!reason) return null;
  return <ProblemNote title={`${what} was not stored. The stored choice is shown again.`} reason={reason} tone="error" />;
}

function Data({ model }: { model: SetupModel }) {
  return (
    <section className="mind__section" aria-labelledby="mind-data">
      <h2 id="mind-data">Where it lives</h2>
      <p className="typo-body">
        One SQLite file: settings, origins, projects, activity and captures. Copy it to move this machine&apos;s Athena.
      </p>
      {model.storePath ? (
        <code className="mind__path">{model.storePath}</code>
      ) : (
        <p className="typo-caption">Not known yet: the app has not said where the file is.</p>
      )}
    </section>
  );
}

function Mic({ model }: { model: SetupModel }) {
  return (
    <section className="mind__section" aria-labelledby="mind-mic">
      <h2 id="mind-mic">Ask once</h2>
      <div className="mind__row">
        <Button
          size="sm"
          variant={model.mic === "granted" ? "secondary" : "primary"}
          onClick={model.actions.checkMic}
        >
          {model.mic === "unknown" ? "Check the microphone" : "Check again"}
        </Button>
        {model.micDetail ? <span className="typo-caption">{model.micDetail}</span> : null}
      </div>
      <p className="typo-caption">Asking here keeps the prompt out of a turn. {engineLabel(model.engine)} runs her turns either way.</p>
    </section>
  );
}

function Missing({ name, go }: { name: string; go: (to: Path) => void }) {
  return (
    <div className="mind mind--level">
      <div className="mind__body">
        <p className="mind__eyebrow">Mind</p>
        <h1 className="mind__marquee mind__marquee--level">No such setting</h1>
        <p className="mind__line">Athena has no setting called {name}.</p>
        <Button variant="secondary" onClick={() => go({ root: "mind" })}>
          Back to all settings
        </Button>
      </div>
    </div>
  );
}
