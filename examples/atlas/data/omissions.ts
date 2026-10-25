/**
 * The modules of `src/athena` the model does not draw, each with the reason it is out of scope.
 *
 * Atlas maps README §3.1 — six layers, the turn of §3.2, the gate of §3.3 — and it is sparse on
 * purpose: a drawing of every module buries the argument. But sparse and silent are different
 * things. A module missing from the drawing is either a scope decision, written down here, or
 * drift, and `test/coverage.test.ts` tells them apart by walking the tree: every module is drawn
 * by a component or covered by an entry below, every entry's path is in the tree, no entry covers
 * a module a component draws, and each entry's `modules` is the tree's own count.
 *
 * A directory entry (trailing `/`) covers a package that README §3.1 does not name as a layer's
 * part; a file entry is a module inside a drawn package that serves a drawn component rather than
 * making a claim of its own. `source` is where the reason was read: the module's first docstring
 * line names its design section (README §7), so that is usually the citation.
 */
import type { Omission } from "./types";

/** Single modules of one drawn directory: `[file, reason, citation]` rows, one module each. */
const inDir = (
  dir: string,
  rows: readonly (readonly [file: string, reason: string, cite: string])[],
  tail = "",
): Omission[] =>
  rows.map(([file, reason, cite]) => ({
    path: `${dir}${file}`,
    reason: `${reason}${tail}`,
    source: `${dir}${file}; ${cite}`,
    modules: 1,
  }));

export const OMISSIONS: Omission[] = [
  /* ------------------- whole packages README §3.1 does not name ------------------- */
  {
    path: "src/athena/adopt/",
    reason:
      "the Adopt studio: a playbook-adoption conversation the daemon hosts beside the turn, not a layer of the turn",
    source: "src/athena/adopt/__init__.py; ADR 0097",
    modules: 15,
  },
  {
    path: "src/athena/peer/",
    reason:
      "One Athena across devices: identity, pairing and the overlay-only peer listener, a second machine's story the one-machine stack does not draw",
    source: "src/athena/peer/__init__.py; ADR 0140",
    modules: 16,
  },
  {
    path: "src/athena/proving/",
    reason:
      "the Proving Ground: Nemotron tested beside a Claude control, an evaluation bench outside the product's runtime",
    source: "src/athena/proving/__init__.py; README §9; ADR 0030",
    modules: 62,
  },
  {
    path: "src/athena/vitals/",
    reason:
      "a PC's room measured and the gate on background tasks: scheduling for the sleep cycle and delegated tasks, not the turn",
    source: "src/athena/vitals/__init__.py; ADR 0143",
    modules: 4,
  },
  {
    path: "src/athena/core/sleep/",
    reason:
      "the sleep cycle distils episodes between conversations; the brain the turn reads is drawn, the consolidation that writes it is not",
    source: "src/athena/core/sleep/__init__.py; ADR 0143",
    modules: 6,
  },

  /* -------------------------- sub-packages of drawn systems -------------------------- */
  {
    path: "src/athena/channels/voice/face_helper/",
    reason:
      "her face, run in another interpreter the daemon never imports: a separate process, not part of the voice channel's stack",
    source: "src/athena/channels/voice/face_helper/__init__.py; ADR 0120",
    modules: 4,
  },
  {
    path: "src/athena/connectors/mcp/",
    reason:
      "external MCP servers as connector ports: one more implementation of the connector port the model draws once (C-061)",
    source: "src/athena/connectors/mcp/__init__.py; README §4; ADR 0123",
    modules: 4,
  },
  {
    path: "src/athena/connectors/providers/",
    reason:
      "per-provider request shapes, pure builders and parsers under the connector service; a provider is data, not a part",
    source: "src/athena/connectors/providers/__init__.py; README §4; ADR 0021",
    modules: 2,
  },

  /* --------------------------- modules inside drawn systems --------------------------- */
  ...inDir(
    "src/athena/channels/voice/",
    [
    ["backends.py", "the voice backend port and its test and provider halves, behind the gateway (C-031)", "ADR 0019"],
    ["config.py", "the voice studio's engine choice, a setting file the gateway reads", "ADR 0028"],
    ["ether.py", "a tone layer over her rendered voice, after the TTS (C-033)", "ADR 0138"],
    ["face.py", "the daemon's client of the face helper, a sidecar of the voice channel", "ADR 0120"],
    ["home.py", "where local speech engines live and how a probe reads them; runs nothing", "ADR 0028"],
    ["install.py", "one-click installers for the local speech engines, a setup step", "ADR 0028"],
    ["kokoro.py", "one local TTS engine behind the backend port", "ADR 0028"],
    ["speech.py", "display text made speakable, a text rule the TTS (C-033) applies", "ADR 0114"],
    ["whisper.py", "one local speech-to-text engine behind the backend port", "ADR 0028"],
    ],
    "; the channel is drawn as gateway, socket, TTS and commands",
  ),
  ...inDir("src/athena/connectors/", [
    ["addresses.py", "one recipient is one address, a rule the egress gate and a provider share", "README §4; ADR 0061"],
    ["health.py", "a credential's health verdict, which the service (C-060) reports", "README §4; ADR 0108"],
    ["oauth.py", "the delegated PKCE grant, the consent step before the vault (C-059) holds a token", "README §4; ADR 0021"],
    ["seal.py", "where a credential rests, sealed by the OS: the vault's (C-059) storage", "README §4; ADR 0021"],
  ]),
  {
    path: "src/athena/contracts/adopt.py",
    reason: "the Adopt studio's wire contract, which belongs with the omitted adopt package",
    source: "src/athena/contracts/adopt.py; ADR 0097",
    modules: 1,
  },
  {
    path: "src/athena/core/brain/text.py",
    reason: "excerpt, slug and line rules the brain shares with the Personas writer, used by the store (C-045)",
    source: "src/athena/core/brain/text.py",
    modules: 1,
  },
  {
    path: "src/athena/core/brain/value.py",
    reason: "one pure recall score over a distilled memory, serving the sleep cycle's lanes",
    source: "src/athena/core/brain/value.py; ADR 0143",
    modules: 1,
  },
  {
    path: "src/athena/core/case_turns.py",
    reason: "which turns ran under which case, a stamp beside the ledger (C-053) for the cases view",
    source: "src/athena/core/case_turns.py; ADR 0127",
    modules: 1,
  },
  {
    path: "src/athena/core/setup.py",
    reason: "the cross-device setup leg's seven tool names and classes, part of One Athena across devices",
    source: "src/athena/core/setup.py; ADR 0140",
    modules: 1,
  },
  ...inDir("src/athena/daemon/", [
    ["decisions.py", "the decision routes, split out of the route table (C-027) the model draws as one door", "README §3.2 steps 4 and 6"],
    ["sleep.py", "the daemon's host for the omitted sleep cycle", "ADR 0143"],
    ["tasks.py", "delegated background tasks and their routes, work outside the one turn", "ADR 0141"],
    ["voice.py", "the voice studio's setup routes, not the voice channel itself (S-07)", "ADR 0028"],
  ]),
  {
    path: "src/athena/harness/ports.py",
    reason:
      "the Protocols the harness runs on; the model draws what the ports connect (hooks to catalog, ledger, approvals), not the port module",
    source: "src/athena/harness/ports.py; README §3.1",
    modules: 1,
  },
  {
    path: "src/athena/harness/rounds.py",
    reason: "the round loop both engines run inside, drawn as the CLI harness (C-039) it was taken out of",
    source: "src/athena/harness/rounds.py; ADR 0007, ADR 0031",
    modules: 1,
  },
  {
    path: "src/athena/harness/tokenfactory.py",
    reason: "the nebius ModelFn itself, configuration behind the API engine (C-070) the model draws",
    source: "src/athena/harness/tokenfactory.py; README §3.1; ADR 0031",
    modules: 1,
  },
  {
    path: "src/athena/harness/vision.py",
    reason: "one picture to a Token Factory vision model, a plain call beside the engine, not a turn",
    source: "src/athena/harness/vision.py",
    modules: 1,
  },
  {
    path: "src/athena/lane/fleet.py",
    reason: "the fleet's rooms in the frame, read from the omitted vitals and peer packages",
    source: "src/athena/lane/fleet.py; ADR 0143",
    modules: 1,
  },
];
