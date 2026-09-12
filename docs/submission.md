# Athena — an agent whose environment is the web apps you already have

Built for the OpenAI hackathon. The engine is **OpenAI Codex**, running on the user's own CLI
sign-in, and the voice is OpenAI's `gpt-4o-mini-transcribe` and `gpt-4o-mini-tts`.

## The problem

A freelancer or a two-person studio runs on software they do not control: an invoicing tool, a
bank portal, a CRM, a support inbox. None of those apps has an agent, none is going to get one,
and the user will not switch tools to get one. Every week the same cross-app chore: read state in
one app, decide, act in another, and keep a record of what was done and why.

A chatbot cannot do that work, because the work is inside the apps. A per-app copilot cannot do it
either, because the work spans them. Athena can, because the apps are her environment rather than
her plug-ins.

## Why being *in* the environment is the whole point

A standalone chatbot is told about the world. Athena is in it, and four things follow that a chat
window cannot have.

**She sees live state, not a description of it.** The turn carries the open tabs, the focused
page, its title and its url — bounded, and fenced so the page's own text can never be read as an
instruction. She is answering about the invoice on screen, not about an invoice someone pasted.

**She acts through the app's own vocabulary.** A page that publishes WebMCP tools is operated
through them: `match_bank_line`, `send_reminder`, `merge_contacts`. The app's own rules apply,
its own audit log fills in, and its undo still works. Nothing is scraped or simulated.

**Where an app offers nothing, she still works.** Eight generic hands — read, find, wait, scroll,
click, fill, select, submit — operate any page as a person would. In our own testing they found
371 operable elements on a Wikipedia article and 230 on Hacker News, neither of which has heard
of us. That is the difference between an agent for software that adopted a protocol and an agent
for the web a person actually has open.

**Memory crosses the tab boundary, which is where the value is.** In the demo Athena learns from a
bank statement that one client pays under a different trading name, and two apps later that fact
settles a naming conflict in a CRM. A chatbot with the same transcript could not have done it:
it was never in the first app to learn it, and never in the third to apply it.

## Built on OpenAI

**Codex is a first-class engine, not an adapter.** The harness speaks two CLI dialects — Codex and
Claude Code — behind one contract, and Codex is selected with a single flag on the daemon or the
doctor. Both run under the same gate, the same ledger, the same prompt composer and the same
`OP:` call grammar, so the engine is a configuration choice and can never become a second policy.
Each dialect is exercised against a recorded transcript in the test suite, so a change in either
CLI's event format is a red test rather than a surprise on stage.

**The engine bills the user's own subscription.** Athena drives the Codex CLI the user is already
signed in to, so no model API key is typed, pasted or stored to run a turn. The setup screen probes
for the CLI and reports what it found.

**Voice is OpenAI end to end.** A WebSocket gateway takes PCM16 from a push-to-talk key,
`gpt-4o-mini-transcribe` turns an utterance into a turn, and `gpt-4o-mini-tts` speaks the reply's
first line. One utterance is one turn and one ledger row; speaking over a reply is a barge-in that
cancels playback by generation counter rather than starting a second turn. The backend reads
`OPENAI_API_KEY` from the environment and is the only part of the system that wants a key; with no
key the gateway degrades to text rather than failing.

## How the environment shaped the architecture

Being a guest in someone else's application forced four decisions that a chat product would never
have to make, and they are the design.

**The gate is the policy, and a model never decides it.** Every tool a page publishes carries two
flags: is this reversible, and do its effects leave the app. A tool is `AUTO` only if it is
reversible and stays inside; everything else is `GATED` and files a decision card that a person
answers. The page cannot argue its way out of that, and neither can the model. A manifest that
fails validation is refused whole rather than half-merged.

**A gated action has no executor until it is approved.** The turn emits the proposal and stops.
When the user answers, the gate is *replayed* with the approval id and the grant is proved against
that exact action and those exact parameters, so an approved card can never be spent on a
different call.

**The page executes its own tools.** The agent's runtime holds no executor for them. It emits the
call, the surface runs it on the page, and the answer rides the next turn's frame inside a
nonce-tagged fence. A page's output is data, never an instruction.

**Nothing is trusted twice.** One application is bound to one web origin; a second origin claiming
the same identity is refused. Generic hands are `GATED` on first sight for every new origin.
Element references are minted only by the page itself and retired on navigation, so a model can
never compose a selector to reach something it was not just shown.

## Technical execution

**The agent core is Python 3.11+ and the standard library, with no runtime dependencies at all.**
Memory is markdown on disk with SQLite FTS5 as a rebuildable index, so a brain is portable by
copying a directory. A fact is refused at write unless it cites live episodes. One writer behind a
lock and a fresh read-only connection per request — with the starvation test written before the
server that had to pass it.

**The surface is a Tauri v2 desktop shell** — Rust, with the `unstable` multi-webview API so one
window holds the chrome, the panel and a page webview per tab. The panel is React 19 with zustand
and Vite. A Rust module owns every rectangle; another owns the sidecar's lifecycle, killing the
Python daemon with a Windows job object so a force-quit cannot orphan it.

**The bridge is plain JavaScript in the page's main world**, polyfilling `document.modelContext`
and answering over `postMessage` with two layered timeouts. It degrades rather than fails: a page
that froze its globals reports zero tools instead of erroring inside someone else's application.

**The channel is HTTP and SSE on loopback**, token-checked on every route, `Connection: close` on
every response, threaded so a ninety-second turn never stalls a read.

**Everything is under one gate.** Ruff, mypy strict, pytest, ESLint, tsc, Vitest, cargo clippy and
cargo test.

| Suite | Tests |
|---|---|
| Python core, harness, daemon, channels | 654 |
| Panel (Vitest) | 133 |
| Rust shell (cargo test) | 66 |
| Page bridge (node --test) | 24 |

Twenty-four architecture decision records explain the choices a later reader could question.

**The demo is a test.** Three Next.js applications — one studio's books, hiring pipeline and
contact list — plus a static page that has never heard of Athena, are booted by Playwright and
driven through the real bridge and the real gate. Four acts, thirty-odd numbered beats, asserted:
both declines are attempted after being declined and prove nothing moved, every gated execution
names the approval that let it through, and every fact cites a live row.

## The experience

**Setup is one screen and no model key.** The engine probe finds the CLI the user is already signed
in to. Readiness is three-valued — healthy, broken, or not yet asked — because "not healthy" is two
different situations and telling someone to install a CLI they already have is worse than telling
them nothing yet. Every check names its own remediation.

**The panel is a column beside the page, not a window in front of it.** The user watches Athena
work on the thing they are looking at.

**A decision card shows the parameters, not a summary of them.** Approving "send a chase" without
seeing which invoice is not consent to anything. Cards sit above the conversation rather than
inside it, because a card that scrolls away is a card answered late — which in this system means a
turn that silently did nothing.

**Every bounded answer says what it left out**, in the same four words everywhere: `(showing N of
M)`. Every refusal comes from one closed vocabulary of fifteen reasons, declared in Python and in
JavaScript with a test that fails when the two drift.

**Cost is visible.** One ledger row per turn, failures and declines included, with the model, the
rounds, the tokens and what it cost. The record shows every call by app and by tier: the page's own
tools, the generic hands, and third-party connectors.

## What it is not

No scraping, no simulated clicks on a canvas, no browser extension the user has to trust with
every site. No model API key: the engine is the user's own Codex sign-in, and the one key in the
system is the voice backend's, read from the environment and never written to disk by us. No cloud:
the brain, the ledger and the approvals are files on the user's machine, and the agent is a sidecar
that dies with the window.
