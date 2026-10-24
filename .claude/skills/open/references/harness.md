# The e2e harness, and how `/open verify` reuses it

Everything below lives in athena-portable `apps/desktop/`. `/open verify` drives these pieces; it never
copies them into the app's repo.

## What is already app-agnostic

| Piece | File | Used at level |
|---|---|---|
| The page in headless Chromium with `inject.js` and the relay, plus `localStorage` seeds for the opt-in | `e2e/support/webmcp-page.ts` (`openAppPage`, `launchBrowser`) | 1, 2 |
| The live pilot's report: `PilotCase`, `CaseReport`, `orientationOf(calls, known, appId, orientTools)`, `pilotMarkdown(title, reports)`, `liveFetch` (10 min turn deadline) | `e2e/support/pilot.ts` | 2 |
| The shell's run loop wired to a real daemon and the page relay, with a recorder: `wireLoop`, `toolCallsOf`, `manifestFor`, `gatedFor`, `registeredTable` | `e2e/shadowrunr/support/loop.ts` (generic apart from the exported `APP_ID`) | 1, 2 |
| A scripted `athena serve` over a transcript; a live one on the signed-in CLI with a scratch home | `e2e/support/daemon.ts` `startDaemon`; `e2e/shadowrunr/support/athena.ts` `startLiveDaemon`, `renderTranscript` | 1, 2 |
| A static server for a built `dist` on `localhost`, tree kill, scratch removal, tree digest | `e2e/shadowrunr/support/shadowrunr.ts` `serveConsole`, `killTree`, `removeScratch`, `treeDigest` | 1, 2, 3 |
| The desktop driver: launch an isolated build or attach (raw CDP), register, retrust, tabs, tools, hands, say, cards, approve, decline, transcript, shot | `drive/athena-drive.mjs`, `drive/raw-cdp.mjs`, CLI `drive/drive.mjs` (`pnpm -C apps/desktop drive ...`) | 3 |

`webmcp-page.ts` and `pilot.ts` were extracted by `/open` 1.0.0 from the Shadowrunr suites, which now
import them (`shadowrunr/support/browser.ts` is a thin wrapper that adds the console's URL and opt-in
key). Keyless suite after the extraction: 8 passed, 5 skipped (live), typecheck and lint clean.

## What is still Shadowrunr's

| Piece | Why it is app-specific |
|---|---|
| `shadowrunr/support/shadowrunr.ts` `OVERLORD`, `missingPieces`, `makeScratch`, `startShadowDaemon`, `rpc` | the checkout layout, the TOML rewrite, the binary and its ready line |
| `shadowrunr/support/browser.ts` `DRIVE_KEY`, `openConsole` | the console's opt-in key and `?daemon=` URL |
| `shadowrunr/support/loop.ts` `APP_ID` | the slug |
| `shadowrunr/transcripts/*.ndjson` | the scripted model turns name Shadowrunr tools and ids |
| `shadowrunr.e2e.test.ts`, `shadowrunr.live.e2e.test.ts` | the cases |
| `desktop/athena-desktop.e2e.test.ts` | the cases, the toggle label, `SHADOWRUNR_CONSOLE_PORT` |

## Proposal: a per-app config the harness reads

One file per app, `apps/desktop/e2e/apps/<app>.app.ts`, exporting an `AppUnderTest`; three generic
suites select it with `ATHENA_APP=<app>`.

```ts
export interface AppUnderTest {
  id: string;                              // the athena:app slug
  /** Reasons the app cannot boot here (binary, build, fixture missing). */
  missing(): string[];
  /** Scratch copies, the backend (keyless), the built UI served on localhost. */
  boot(): Promise<BootedApp>;
  /** localStorage entries that switch the app's opt-in on. */
  optIn: Readonly<Record<string, string>>;
  /** The toggle as a person sees it, for level 3: its role/label when off and on. */
  toggle?: { off: string; on: string };
  orientTools: readonly string[];          // where_am_i, app_map, go_to
  requiredTools: readonly string[];        // pairing asserts these are listed
  minTools: number;
  /** A start hash and a valid go_to target for the generic orientation case. */
  views: { start: string; target: string };
  /** One READ and one GATED call with args that are safe on scratch, for levels 1 and 3. */
  probes: { read: { name: string; input: Record<string, unknown> }; write?: { name: string; input: Record<string, unknown>; check(b: BootedApp): Promise<boolean> } };
  pilot: readonly PilotCase[];
}

export interface BootedApp {
  url: string;                             // what the tab opens, ?backend= included
  origin: string;                          // http://localhost:<port>
  guards: { label: string; path: string; before: string }[];  // real trees, digested before boot
  stop(): Promise<void>;                   // kills trees, removes scratch, on failure too
}
```

The generic suites:

| Suite | Level | Cases, all from the config |
|---|---|---|
| `e2e/apps/catalog.e2e.test.ts` | 1 | the meta tag; the relay lists at least `minTools` and every `requiredTools`; `POST /manifest` with the shell's body has no `problems`; the footprint of the listed tools by the renderer port is at most 5,000; every listed description at most 240; `where_am_i` and `probes.read` answer at most 1,500; opt-out lists zero; the guards did not move |
| `e2e/apps/scripted.e2e.test.ts` | 1 | orientation and one approved and one declined write, over transcript templates with `{{APP}}`, `{{TARGET}}` and the probe's args, so a new app needs no hand-written transcript for the floor cases |
| `e2e/apps/pilot.live.e2e.test.ts` | 2 | `pilot` cases through `pilot.ts`, the report under `out/<stamp>/` |
| `e2e/desktop/app.e2e.test.ts` | 3 | register, toggle, retrust (a read AUTO, a write GATED), one orienting turn, one approved and one declined card, the guards |

Shadowrunr becomes `e2e/apps/shadowrunr.app.ts` (its `boot` is today's `makeScratch` +
`startShadowDaemon` + `serveConsole`), and its own suites stay for the cases only it has.

Not implemented in 1.0.0: it moves the Shadowrunr suites' wiring, and its value shows only with a second
app. Build it in the `/open build` of the second app, in the same change as that app's config, and keep
`pnpm -C apps/desktop test:e2e:shadowrunr` green.

## Two harness hazards found while writing this skill

1. **A worktree silently skips everything.** `OVERLORD` defaults to `<repo root>/../overlord`; from a
   worktree under `.claude/worktrees/<name>/` that is `.claude/worktrees/overlord`, which does not exist,
   so both files skip "no shadowrunr binary" and the run exits 0 with 13 of 13 skipped (measured
   2026-10-24). Until the default resolves through the main checkout (`git rev-parse --git-common-dir`),
   set `SHADOWRUNR_ROOT` (and `SHADOWRUNR_MAIN`) explicitly, and `/open verify` fails a level whose
   passed count is zero.
2. **The desktop suite needs an exe and a quota.** `ATHENA_DESKTOP=1` without an exe skips with a reason;
   a skip is not a pass.
