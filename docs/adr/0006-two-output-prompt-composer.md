# 0006. The prompt has two outputs, and the law ships inside the wheel

Date: 2026-09-12

## Context

The first build composed one prompt. The constitution, the identity, the capability block, the
recalled memory and the host state were assembled into a single string and handed to the CLI
engine as its system prompt. The engine resumes a conversation with `--resume`, and a resumed
session keeps the system prompt it was opened with. So `host_state` — the tabs the user has open,
the page they are looking at, the project they switched to — reached the model on turn one and
never again. Every later turn of that conversation reasoned about a picture of the world that had
been true once. README §3.5 records the finding; this is the commit that decides against it.

There is a second decision in the same commit, because the static half of the split is the
constitution and the constitution has to be found before it can be composed. Athena runs from
three shapes — a source checkout, an installed wheel, a frozen one-file binary — and the first
build resolved its `constitution/` by walking three directories above the module. In a checkout
those three parents are the repository. In an installed wheel they are `site-packages/..`, and in
a PyInstaller binary they are a temporary extraction directory that other processes can write
into. A loader that reads law from whatever happens to sit there is a loader that can be handed
different law.

## Decision

**`compose()` returns two objects, and which one a block belongs to is decidable from its name.**

- `StaticBlocks` is the system prompt: `constitution`, `identity`, `capabilities`, `memory.always`.
  It is composed once per conversation and is byte-identical on every turn of it.
- `TurnFrame` is part of the user message, composed fresh every turn: `frame.project`,
  `frame.host_state`, `frame.tools`, `frame.memory`, `frame.episodes`, `frame.decisions`.
- The rule is enforced, not remembered. `compose` raises `PromptError` if a static block's name is
  not in `STATIC_NAMES`, if a static block is marked `untrusted`, or if a frame block's name does
  not begin with `frame.`. A future block is placed by naming it, and the wrong name fails loudly
  at compose time rather than quietly on turn two of a resumed session.
- Host state rides as a **delta against the previous frame**, not as a snapshot. The composer
  keeps no state: `TurnFrame.host_state` is handed back as `previous_host_state` next turn, so two
  callers cannot disagree about what the model was last shown. `first` and `empty` are different
  deltas and read differently in the prompt, because "here is everything" and "nothing moved" are
  different claims.
- The always-include memory tier is the one recall lane in the system prompt. It is
  conversation-scoped by design (README §2 invariant 4): it answers "what is true whatever was
  asked", it is refreshed when a conversation is opened, and the query-driven lanes that answer
  *this* message are in the frame. A fact written mid-conversation therefore reaches the model
  through the frame's recall, and `StaticBlocks.hashes()` moving is the signal that the
  conversation should be reopened.
- **Static blocks are never fenced.** They are Athena's own text rather than a page's, and a fence
  carries a fresh nonce, which would move every static hash every turn and destroy the only
  property that makes prompt-cache churn detectable. Every untrusted block in the frame *is*
  fenced, with one fresh nonce per frame.
- The composer takes Protocols — `CatalogPort`, `RecallPort`, `HostStatePort` — rather than
  `Catalog`, `RecallTrace` and a brain handle. `core/catalog.py` imports `connectors.port` and
  `core/recall.py` opens SQLite; the module that builds a string should need neither, and the
  harness has to be testable against fakes.

**The fence neutralises replayed markers, not only guessed ones.** `fence.wrap_untrusted` strips
every open and close marker of its label out of the body before wrapping — the exact markers for
this nonce first, then a pattern that matches any nonce. An unguessable nonce is not enough on its
own: a previous turn's prompt can reach the page through a tool that echoes its input, a
screenshot, or an agent that forwards a transcript, and a replayed closing marker would end the
fence early and let the rest of the payload be read as instruction. The replacement is the visible
string `[fence marker removed]` rather than a silent deletion, because a fence that edits its
payload without saying so is lying about what the page said.

**The constitution ships inside the wheel, and a checkout is read only through a marker.** One
copy of the law lives at the repository root in `constitution/`, where it is reviewable as prose.
`[tool.hatch.build.targets.wheel.force-include]` maps it to `athena/constitution/` in the wheel,
which is the only source an installed Athena has; the freeze script will pass the same mapping to
PyInstaller's `--add-data`. `constitution.search_path` then offers, in order: an explicit argument
or `$ATHENA_CONSTITUTION` (alone, because a deployment that named a directory does not want a
fallback), the frozen bundle, the packaged copy, and last the repository — and the repository only
when a `.athena-constitution` file sits *beside* its `constitution/`. A bare directory that merely
contains a `constitution/` is refused.

Every default in `search_path` is overridable by keyword, so the tests build a real installation
under `tmp_path` and exercise the real resolution rather than patching module state and exercising
the patch.

## Consequences

A resumed conversation now sees current host state on every turn, which was the point. The cost is
that the frame is sent every turn and is not cached by the provider, so the tokens that carry the
tabs are paid for repeatedly. That is the correct trade: the alternative was paying once for a
picture that is wrong.

Placing the always tier in the system prompt is the one judgement call in the split that could be
revisited. It buys prompt-cache stability for the largest memory block; it costs a conversation
that runs for hours the facts written during it, until the frame's recall picks them up or the
conversation is reopened. `StaticBlocks.hashes()` and `churn()` exist so that a future harness can
decide to reopen automatically, without changing this contract.

The marker file is one more thing that must be copied for a development checkout to work, and a
developer who copies `src/` alone gets a `ConstitutionMissing` naming every place that was looked
in. That is the intended failure: Athena runs without law only on purpose.

`force-include` means the wheel and the checkout read the same bytes from two paths, so the
packaging is verified by building a wheel rather than by a unit test. The loader test that proves
the packaged copy works builds the installed layout under `tmp_path` instead, which checks the
resolution but not the mapping in `pyproject.toml`.
