/**
 * `docs/adr/` — the twenty-five decisions, by number, so a component can cite one and L2 can
 * print its title without the reader leaving the page.
 *
 * Titles are the ADRs' own H1s, shortened only where an H1 restates its own number. The `file`
 * is the path in this repository; nothing here fetches it, and there is no link — a component's
 * ADR is a citation, the same as its file path.
 */
import type { Adr } from "./types";

export const ADRS: Adr[] = [
  { n: 1, title: "Record decisions as ADRs in this directory", file: "docs/adr/0001-record-decisions.md" },
  { n: 2, title: "The core is stdlib-only and the contracts import nothing at all", file: "docs/adr/0002-stdlib-only-core.md" },
  { n: 3, title: "Disk is truth, the index is rebuildable, and reads get their own connection", file: "docs/adr/0003-disk-is-truth-one-writer-many-readers.md" },
  { n: 4, title: "The catalog derives every class, and a connector merges like a page", file: "docs/adr/0004-the-gate-is-the-policy.md" },
  { n: 5, title: "Approvals and the ledger live in the brain's index, outside the tables a reconcile clears", file: "docs/adr/0005-approvals-and-the-ledger-live-in-the-brains-index.md" },
  { n: 6, title: "The prompt has two outputs, and the law ships inside the wheel", file: "docs/adr/0006-two-output-prompt-composer.md" },
  { n: 7, title: "Engines are configuration; the gate is the same behind all of them", file: "docs/adr/0007-engines-are-configuration.md" },
  { n: 8, title: "The page half of the bridge degrades to \"no bridge\" instead of failing", file: "docs/adr/0008-the-page-half-of-the-bridge-degrades-instead-of-failing.md" },
  { n: 9, title: "One refusal vocabulary and one fence, declared in two languages and pinned by a test", file: "docs/adr/0009-one-refusal-vocabulary-declared-in-two-languages.md" },
  { n: 10, title: "The browser lane holds no gated executor; the page executes on approval", file: "docs/adr/0010-the-browser-lane-holds-no-gated-executor.md" },
  { n: 11, title: "The daemon is threaded, closes every connection, and checks the token on every route", file: "docs/adr/0011-the-daemon-is-threaded-closes-every-connection-and-checks-the-token-everywhere.md" },
  { n: 12, title: "One turn is one SSE stream of channel events, and a card is one frame", file: "docs/adr/0012-one-turn-is-one-sse-stream-of-channel-events.md" },
  { n: 13, title: "The window is module-first, and the browser is one module inside it", file: "docs/adr/0013-module-first-window.md" },
  { n: 14, title: "Page webviews get exactly one command, and the relay holds the id map", file: "docs/adr/0014-page-webviews-get-one-command-and-the-relay-holds-the-id-map.md" },
  { n: 15, title: "The daemon is spawned into a Windows job object and handed its token in a file", file: "docs/adr/0015-the-sidecar-is-owned-by-a-job-object-and-fed-a-token-file.md" },
  { n: 16, title: "The shell's store is one described schema behind four key/value commands", file: "docs/adr/0016-the-store-is-one-described-schema-behind-four-commands.md" },
  { n: 17, title: "The example apps are one studio's tabs and carry the demo journey", file: "docs/adr/0017-the-example-apps-are-one-studio-and-carry-the-demo-journey.md" },
  { n: 18, title: "Ledgerbox ships The Lanes, and one page carries both tool layers", file: "docs/adr/0018-ledgerbox-ships-the-lanes-and-one-page-carries-both-tool-layers.md" },
  { n: 19, title: "Voice is a WebSocket on the daemon's port, and a transport around the one lane", file: "docs/adr/0019-voice-is-a-socket-on-the-daemons-port-and-a-transport-around-the-one-lane.md" },
  { n: 20, title: "Push-to-talk is a held key in the chrome, and a spoken turn lands in the panel", file: "docs/adr/0020-push-to-talk-is-a-held-key-in-the-chrome-and-a-spoken-turn-lands-in-the-panel.md" },
  { n: 21, title: "Connectors are data behind one vault, and enter the catalog like a page", file: "docs/adr/0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md" },
  { n: 22, title: "The dossier is one action bar of two zones, and arming takes the bar", file: "docs/adr/0022-the-dossier-is-one-action-bar-of-two-zones-and-arming-takes-the-bar.md" },
  { n: 23, title: "Contrast is measured against the composited surface, and the label tier carries the accent", file: "docs/adr/0023-contrast-is-measured-against-the-composited-surface-and-the-label-tier-carries-the-accent.md" },
  { n: 24, title: "The shell's second pass: apps as a ledger, the panel as a conversation, setup as one module", file: "docs/adr/0024-the-shells-second-pass-apps-as-a-ledger-the-panel-as-a-conversation-setup-as-one-module.md" },
  { n: 25, title: "The screenshot is a hand the shell answers, and it is of the window cropped to the page", file: "docs/adr/0025-the-screenshot-is-a-hand-the-shell-answers-and-it-is-of-the-window-cropped-to-the-page.md" },
];
