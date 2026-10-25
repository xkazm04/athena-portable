import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createPresence } from "@/lib/halo";
import { HALO_EVENT, HALO_PHASES, haloPhase, isHaloPhase } from "@/lib/halo-signal";

describe("haloPhase", () => {
  it("lets listening win over everything", () => {
    expect(haloPhase("listening", "running", 3)).toBe("listening");
  });

  it("puts her voice above work in flight", () => {
    expect(haloPhase("speaking", "acting", 0)).toBe("speaking");
  });

  it("shows thinking for a voice turn or a run in flight", () => {
    expect(haloPhase("thinking", "idle", 0)).toBe("thinking");
    expect(haloPhase("idle", "running", 0)).toBe("thinking");
    expect(haloPhase("off", "acting", 2)).toBe("thinking");
  });

  it("shows a waiting card once nothing else is happening", () => {
    expect(haloPhase("idle", "idle", 1)).toBe("gate");
    expect(haloPhase("error", "error", 1)).toBe("gate");
  });

  it("rests at idle", () => {
    expect(haloPhase("off", "idle", 0)).toBe("idle");
    expect(haloPhase("error", "error", 0)).toBe("idle");
  });
});

describe("the Rust mirror (src-tauri/src/halo.rs)", () => {
  it("parses exactly the phases the page names, in the same order", () => {
    // halo.rs's own test enumerates the names by hand; this one reads its parser, so a phase added
    // on one side only (refused by the shell, or never drawn by the page) fails here.
    const rust = readFileSync(new URL("../../src-tauri/src/halo.rs", import.meta.url), "utf8");
    const arms = [...rust.matchAll(/"([a-z]+)" => Phase::/g)].map((m) => m[1]);
    expect(arms).toEqual([...HALO_PHASES]);
  });

  it("[7] ends with trouble, the sixth phase, on both sides", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/halo.rs", import.meta.url), "utf8");
    expect(HALO_PHASES.at(-1)).toBe("trouble");
    expect(rust).toContain('"trouble" => Phase::Trouble');
    expect(isHaloPhase("trouble")).toBe(true);
  });

  it("names the same event", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/halo.rs", import.meta.url), "utf8");
    expect(rust).toContain(`pub const HALO_EVENT: &str = "${HALO_EVENT}";`);
  });
});

describe("isHaloPhase", () => {
  it("accepts the six names and nothing else", () => {
    expect(isHaloPhase("gate")).toBe(true);
    expect(isHaloPhase("hear")).toBe(false);
    expect(isHaloPhase(1)).toBe(false);
  });
});

describe("createPresence: her phase with the tail of a line still sounding", () => {
  it("[0] reads speaking after voice.stopped while the last line seen playing still sounds, idle once it does not", () => {
    let sounding = true;
    const presence = createPresence({ sounding: (generation) => generation === 7 && sounding });
    expect(presence.phase({ voice: "speaking", run: "idle", cards: 0, generation: 7 })).toBe("speaking");
    expect(presence.phase({ voice: "idle", run: "idle", cards: 0, generation: null })).toBe("speaking");
    expect(presence.spoken()).toBe(7);
    sounding = false;
    expect(presence.phase({ voice: "idle", run: "idle", cards: 0, generation: null })).toBe("idle");
  });

  it("lets listening win over the tail, and never invents a tail for a line it never saw", () => {
    const presence = createPresence({ sounding: () => true });
    expect(presence.phase({ voice: "idle", run: "running", cards: 0, generation: null })).toBe("thinking");
    expect(presence.phase({ voice: "speaking", run: "idle", cards: 0, generation: 3 })).toBe("speaking");
    expect(presence.phase({ voice: "listening", run: "idle", cards: 0, generation: null })).toBe("listening");
  });
});
