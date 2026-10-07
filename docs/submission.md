# Athena Portable — an agent that works inside the web apps you already use

Built for the Nebius x NVIDIA Global AI Hackathon. Day to day, Athena reasons on the CLI the user
is already signed in to, Claude Code or Codex, and speaks with local Kokoro. Nebius and NVIDIA are
her **Proving Ground**: NVIDIA Nemotron models on Nebius Token Factory attack her gate, play her
users and judge the result beside a Claude control. The Proving Ground is **planned**; the sections
below say exactly what exists and what does not.

## What it is, in one paragraph

Athena is a desktop application that holds your web apps in tabs and an agent in a column beside
them. The agent sees the page you are looking at and can operate it: when the page offers its own
actions, she calls them; when it offers nothing, she reads, clicks, types and submits the way a
person would. Anything irreversible or anything that leaves the app stops and asks you first. Every
call and every cost is written to a local record. Nothing is installed into the websites, no
extension is granted access to your browsing, and no data leaves your machine except the model and
voice calls themselves.

## What the Proving Ground adds (planned)

An agent that operates other people's software is only as good as its refusals, and today
Athena's refusals are held by hand-written tests. The Proving Ground replaces the hand with an
adversary and a crowd, and none of it is built yet:

- **A gauntlet.** Nemotron generates attacks on four channels — instructions planted in host page
  state, in tool results, from a foreign agent over MCP, and memory poisoning — and each is replayed
  against Athena on the Claude CLI and on Nemotron. The proof test is that zero gated actions or
  fact writes ran without approval across every row.
- **Model-played users.** Nemotron plays the representative users already written in `uat/`,
  and Nemotron and Claude Haiku judge the conversations blind against the same rubric.
- **Branching worlds.** Token Factory Sandboxes are spiked as worlds that are checkpointed once
  and forked per attack.
- **A third engine for measurement.** A `nebius` engine runs Athena on Nemotron behind the same
  gate and the same ledger row, as a matrix row beside the Claude CLI, not as her daily engine.

Because the quality of the NVIDIA tooling is not yet known to us, every Nemotron role has a Claude
Haiku control row and a kill criterion. Results, latencies and costs are reported only once a run
has produced them.

## What changed in the hackathon period

Every commit in this repository is dated after the period opened on 2026-08-26: Athena was rebuilt
from scratch here, with an earlier product as prior art only. The Proving Ground is the hackathon's
addition and is listed above as planned until it lands.

## The problem

Most people's work lives in software they do not control: an invoicing tool, a bank portal, a CRM,
a support inbox. None of those products has an agent, most never will, and nobody switches tools to
get one. The work that costs the most time is the work that crosses them — read state in one app,
decide, act in another, and keep a record of what was done and why.

A chatbot cannot do that work, because the work is inside the apps. A copilot built into one app
cannot either, because the work spans them. Athena can, because the apps are her environment rather
than her integrations.

## What she can actually do

**Operate a page that was built for agents.** A web app can publish its own actions — the same
capability model as a tool-using API, but declared by the page. Athena calls those in the app's own
vocabulary, so the app's validation runs, its audit trail fills in and its undo still works.
Nothing is scraped and nothing is faked.

**Operate a page that was not.** Eight generic abilities — read, find, wait, scroll, click, fill,
select, submit — work on any website. They read the page's accessibility structure rather than its
markup, so they describe a page in terms of what can be done to it rather than in terms of HTML.
On unmodified public sites in our own testing this found 371 operable elements on a Wikipedia
article and 230 on a Hacker News front page. This is the difference between an agent for software
that adopted a protocol and an agent for the web a person already has open.

**Reach a service with no page at all.** Third-party APIs enter through the same door as a page:
each is described as a set of actions with the same two safety flags, so an email or calendar
service is governed by exactly the mechanism a website is.

**Remember across apps and across sessions.** Long-term memory is markdown files on disk with a
full-text index over them. A remembered fact is refused at write time unless it cites the actual
observations it came from, so the memory can always be traced back to something that happened. A
fact learned while working in one app is available in the next one, which is where most of the
value of an agent that spans apps actually comes from.

**Be spoken to.** Hold a key, say what you want, hear the first line of the answer back. One
utterance is one turn.

**Show its work.** One row per model call — including failures and refusals — with the engine, the
rounds, the tokens and the cost. The record groups calls by app and by which of the three
capability layers served them: the page's own actions, the generic abilities, or a connected API.

## The architecture, and why it has this shape

Being a guest inside software that belongs to someone else is the constraint that produced every
important decision here.

**Approval is structural, not advisory.** Every action carries two facts: is it reversible, and do
its effects leave the app. An action runs unattended only if it is reversible *and* stays inside.
Everything else stops and files a decision card. A web page cannot mark its own destructive action
as safe, and the model is never asked to decide — the policy is computed from the declaration, in
one place, before anything runs.

**A gated action has no way to run before it is approved.** The agent's turn ends at the proposal.
When the user answers, the action is re-checked and the approval is proved against that exact
action with those exact parameters, so a granted approval cannot be spent on a different call.

**The page executes its own actions; the agent never does.** The runtime holds no executor for a
page's tools. It emits the call, the page runs it, and the result comes back as quoted data inside
a fence the model cannot break out of. A page's output is evidence, never instruction — which is
the defence against a website trying to talk to the agent reading it.

**Identity is bound to origin.** One application is one web origin. A second origin claiming the
same identity is refused. Generic abilities start gated on every site the user has not yet trusted,
so even reading an unfamiliar page is a decision the first time.

**References expire.** An element reference is minted only by the page itself and retired the
moment the page navigates, so the model can never construct a handle to something it was not just
shown.

## Technical execution

**Agent core** — Python 3.11+ with **zero runtime dependencies**. Memory is markdown on disk with
SQLite FTS5 as a rebuildable index, so a user's entire memory is portable by copying a folder. One
writer behind a lock, a fresh read-only connection per request, and the writer-starvation test was
written before the server that had to pass it.

**Engine** — two command-line dialects behind one contract: Claude Code and Codex. Both run under
the same approval gate, the same record, the same prompt composition and the same call grammar, so
the engine is a configuration choice and can never become a second policy. Each dialect is replayed
against a recorded transcript in the test suite, so a change in either CLI's output format fails a
test rather than a demo. Because the engine is the CLI the user already signed in to, running a
turn needs no model API key at all. A third engine, **NVIDIA Nemotron through Nebius Token
Factory**, is planned for the Proving Ground only; it needs a Token Factory key (`NEBIUS_API_KEY`)
and sits behind the same gate and ledger row.

**Voice** — a WebSocket gateway on the agent's own port. PCM16 audio from a push-to-talk key turns
an utterance into a turn, and the reply's first line is spoken back. Speaking is local Kokoro by
default and hearing can be local Whisper, set up in a Voice studio (ADR 0028); OpenAI's speech
models are an optional cloud backend, labelled as cloud and never a silent fallback. Talking over a
reply cancels playback rather than starting a second turn.

**Desktop shell** — Tauri v2 in Rust, using the `unstable` multi-webview API so a single window
holds the app chrome, the agent panel and one web view per tab. The panel is React 19 with zustand
and Vite. One Rust module owns every rectangle in the window; another owns the Python sidecar's
lifetime and kills it through a Windows job object, so force-quitting the window cannot orphan a
background process.

**Page bridge** — plain JavaScript injected into the page's main world, polyfilling the
`document.modelContext` interface and answering over `postMessage` behind two layered timeouts. It
degrades rather than breaks: a page that has frozen its own globals simply reports no tools instead
of throwing inside someone else's application.

**Transport** — HTTP and server-sent events on loopback only, token-checked on every route,
threaded so a ninety-second turn never blocks a status read.

**Quality bar** — Ruff, mypy strict, pytest, ESLint, tsc, Vitest, cargo clippy and cargo test, with
a documented architecture decision record for every choice a later reader could question.

Test counts are to refresh at submit; the figures below were taken before the Proving Ground work.

| Suite | Tests |
|---|---|
| Python core, engine harness, daemon, voice | 654 |
| Panel (Vitest) | 133 |
| Rust shell (cargo test) | 66 |
| Page bridge (node --test) | 24 |

An end-to-end suite boots real web applications — three instrumented and one that has never heard
of Athena — and drives them through the real bridge and the real gate in a real browser, asserting
that a refused action moved nothing, that every gated execution names the approval that permitted
it, and that every remembered fact cites a real observation.

## Why it feels usable rather than impressive

**Setup is one screen and no key.** The app looks for the CLI you are already signed in to.
Readiness is three-valued — working, broken, or not yet checked — because "not working" and "not
asked yet" are different situations, and telling someone to install software they already have is
worse than telling them nothing yet. Every failed check names its own fix.

**The agent sits beside the page, not in front of it.** You watch the work happen on the thing you
were already looking at.

**A decision card shows the parameters, not a summary of them.** Approving "send the reminder"
without seeing which invoice is not consent to anything. Cards sit above the conversation rather
than scrolling away inside it.

**Every shortened answer says what it left out**, in the same four words everywhere: `(showing N of
M)`. Every refusal comes from one closed list of fifteen reasons, declared once in Python and once
in JavaScript, with a test that fails the build when the two drift apart.

## Non-goals

No scraping and no pixel-guessing. No browser extension asking for access to everything you visit.
No cloud account: memory, approvals and the cost record are files on your machine, and the agent
process dies with the window. The Proving Ground runs on Nebius against synthetic users and the
example apps, never against a user's own brain; the product path does not change.
