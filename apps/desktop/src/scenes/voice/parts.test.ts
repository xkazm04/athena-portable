/**
 * Tests for the Voice scene's shared pieces — README section 3.1, ADR 0026 and 0027.
 *
 * `HOTKEY` is the chord the scene tells a person to hold from anywhere, and it is typed by hand
 * beside the Rust that registers it (`hotkeys.rs` `summon()`). This reads the Rust, so the words
 * cannot name a chord the shell does not hold.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOTKEY } from "./parts";

const rust = readFileSync(new URL("../../../src-tauri/src/hotkeys.rs", import.meta.url), "utf8");
const model = readFileSync(new URL("../../modules/voice/model.ts", import.meta.url), "utf8");

const MODIFIER: Record<string, string> = { CONTROL: "Ctrl", SHIFT: "Shift", ALT: "Alt", SUPER: "Win" };

/** The chord `summon()` registers, in the words the scene uses: `Ctrl+Shift+Space`. */
function summonChord(source: string): string {
  const body = /fn summon\(\) -> HotKey \{\s*HotKey::new\(Some\(([^)]*)\),\s*Code::(\w+)\)/.exec(source);
  if (!body) throw new Error("hotkeys.rs has no summon() of the expected shape");
  const mods = body[1]!.split("|").map((m) => {
    const name = m.trim().replace(/^Modifiers::/, "");
    const word = MODIFIER[name];
    if (!word) throw new Error(`unmapped modifier ${name}`);
    return word;
  });
  const key = body[2]!.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
  return [...mods, key].join("+");
}

describe("the chord the scene names is the one the shell registers", () => {
  it("HOTKEY is hotkeys.rs summon()", () => {
    expect(summonChord(rust)).toBe("Ctrl+Shift+Space");
    expect(HOTKEY).toBe(summonChord(rust));
  });

  it("the module's first words name the same chord", () => {
    const named = model.match(/Ctrl\+[A-Za-z+]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const chord of named) expect(chord).toBe(HOTKEY);
  });

  it("reads the modifiers and the key, not a constant", () => {
    const moved = rust.replace("Modifiers::CONTROL | Modifiers::SHIFT), Code::Space", "Modifiers::ALT), Code::KeyK");
    expect(summonChord(moved)).toBe("Alt+K");
  });
});
