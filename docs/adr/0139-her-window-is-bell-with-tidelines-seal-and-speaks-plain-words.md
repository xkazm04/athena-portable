# 0139. Her window is Bell with Tideline's seal, and speaks plain words

Date: 2026-10-24 (contest athena-mini-window and its merge round)

Amends the *identity* half of [0026](0026-athena-is-her-own-window-and-main-is-the-workhorse.md): The
Countersign's housing, paper slip and stamp. The named states, their sizes, the seal as the anchor of
every resize, "hide means put away, not mute" and the IPC contract all stand unchanged.

## Context
The owner's verdict on her window: it did not reach the quality of Main, and because it is smaller it
should exceed it. It was a light paper card on a dark housing, and it printed what she received
verbatim: a tool row read `host.ledgerbox.read_inbox → {"showing":4,"of":4,"items":[...]}`, and her
own text carried `OP: {...}` and `TTS: "..."` lines.

A contest (`.contest/arena/athena-mini-window`, no LLM judge) put two seats at three variants each
against six sessions shaped exactly like what the window receives. The owner chose **B/1, Bell**
(the conversation as a descent: one plain sentence per step, the detail one level down) **with A/1
Tideline's logo, seal shape and animation** (Main's jellyfish dome with the A mark and its tendrils).
A merge round built that pair and the owner accepted it for the product.

## Decision
- **Plain words, from one pure translator** (`companion/translate/`): a raw entry and what the turn
  has shown in, one message out - a title, a line under it, and its detail (a table, a comparison, a
  letter, facts or a quote) one level down. Nothing is written per tool; a tool it has never seen
  reads as its humanised verb and whatever its JSON carries. `readJson` is the one place a tool's
  output is parsed. A waiting decision says what it will do to whom (`translate/decision.ts`). The raw
  text is reachable only behind "Technical record". Ported line for line from the winner and checked
  against it on the six sessions (35 of 35 identical).
- **The seal is one component** (`seal.tsx`, `seal.css`) with one input, a `SealState` the model
  picks from a table (`sealStateOf`). Its drawing and its animation rules are the winner's, byte for
  byte; the human colour sits on it only as the ring of ink while something waits on the person.
- **The ledger is a descent.** One conversation on a rail; any step opens one level down (`descend`,
  `rise`; Esc rises before it closes anything). The Record and the apps she may act on are pages
  beside the conversation, opened from the ledger's header, not tabs.
- **Every product fact stays on the card.** Every parameter, the capture, a changed contract (ADR
  0100), the bound tab (ADR 0103), the connector's account (ADR 0116) and sheets (ADR 0104) are on
  the card's back ("Read it first") or its front when they would stop it. "Nothing runs until you
  sign" is on every card.
- **Outfit is bundled** (`@fontsource/outfit`, OFL) for the display tier, so her window renders the
  winner's type offline.

## Consequences
- Held to the winner's computed styles (`style-contract.py`, 63 roles across the ledger, slip, tape,
  welcome and an opened step): 3 deviations, all structural - the composer is a textarea because Main
  hands it multi-line drafts (ADR 0040); the slip's Speak pill shares the eyebrow's row; a live turn
  draws the beads it has, where the winner's replay knew the total.
- The type floor is the product's: the winner's 11.5px eyebrows and key labels are 12px.
- Automation reads her by the new hooks (`drive/README.md`): `article.decision[data-card|data-sheet]`
  for a waiting decision, `.msg-step[data-tool]` for what she did.
