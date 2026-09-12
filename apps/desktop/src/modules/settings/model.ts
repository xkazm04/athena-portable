/**
 * The settings module (README §5 phase P4: "store + Settings + Setup").
 *
 * Four things, and what is *absent* is the design. There is no field for an API key, because no
 * key is stored anywhere in this system (README act 1). There is no per-project browsing profile,
 * which §8 lists as a non-goal. And the brain root is a path rather than a picker, because a brain
 * is portable by copying a directory (invariant 1) and typing where it is is the whole of moving it.
 */

export interface SettingsModel {
  engine: string;
  engines: string[];
  model: string;
  brainRoot: string;
  homeUrl: string;
  /** Set while a save is in flight, so the view can say so rather than look inert. */
  saving: boolean;
  /** What the shell said when it refused or repaired what was typed. */
  problems: string[];
  savedAt: string | null;
}

export interface SettingsActions {
  save(next: { engine: string; model: string; brainRoot: string; homeUrl: string }): void;
}

const ENGINES = ["claude_code", "codex"];

export const fixtures: Readonly<Record<string, SettingsModel>> = Object.freeze({
  empty: {
    engine: "claude_code",
    engines: ENGINES,
    model: "",
    brainRoot: "",
    homeUrl: "https://github.com",
    saving: false,
    problems: [],
    savedAt: null,
  },

  "a brain elsewhere": {
    engine: "claude_code",
    engines: ENGINES,
    model: "claude-opus-5",
    brainRoot: "D:/brains/studio",
    homeUrl: "https://ledgerbox.example",
    saving: false,
    problems: [],
    savedAt: "2026-09-12T09:14:00+00:00",
  },

  saving: {
    engine: "codex",
    engines: ENGINES,
    model: "",
    brainRoot: "",
    homeUrl: "https://github.com",
    saving: true,
    problems: [],
    savedAt: null,
  },

  repaired: {
    engine: "claude_code",
    engines: ENGINES,
    model: "",
    brainRoot: "",
    homeUrl: "https://github.com",
    saving: false,
    problems: ["engine must be one of claude_code, codex: \"gpt-9\""],
    savedAt: null,
  },
});
