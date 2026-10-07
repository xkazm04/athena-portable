# uat - Character-driven acceptance for Athena Portable

Engine: the `uat` skill (v1.11.0). This directory is the per-app overlay: who the users are, what they
are trying to finish, how to reach a known start state. Run with `/uat run [--l1|--l2]`.

**Target group (derived from README section 1, not a generic roster):** a freelancer or a two-person studio
whose work is spread across web apps they do not control, on Windows, who already pay for Claude Code or
Codex. Plus the two people who judge the product without being its user: the skeptic who must trust a
gate, and the evaluator who sees it for five minutes.

**Surface under test:** the Tauri desktop app (ADR 0026): the Main window (Browser, Connectors, Setup) and
the Athena companion window (seal, tape, hear, slip, welcome, ledger, tab).

## Characters (5)
mira (owner, primary) - jonas (skeptic, trust) - priya (first-time, Codex only) - ana (keyboard-first,
low vision, 150% scaling) - juror (five-minute evaluator, external buyer).

## Journeys
J1 first-launch - J2 live-with-her - J3 decide-a-card - J4 trust-record - J5 workday-main.

## Drain homes
- analysis docs: `docs/uat-insights/<run-id>.md`
- backlog: `docs/BACKLOG.md`
- concept docs: `docs/adr/` (one ADR per decision, AGENTS.md)

## How to run L2
See `env.md`. The driver is `driver/drive-script.mjs` (Playwright over CDP into WebView2).

## LC: the conversation level, with model-played Characters
LC sits between L1 and L2. It drives the real agent in text against model-played users. It does not
drive the desktop UI, so it certifies conversations, never windows (README §9; ADRs 0034, 0036).

- **Who plays the users.** NVIDIA Nemotron on Nebius Token Factory plays mira, jonas, priya and ana from
  their files here: role, chore, senior bar, background, voice, expectations and pet peeves. The juror is
  an evaluator, not a user, and is not played. The scored acceptance criteria are not given to the
  simulator, because they score the UI.
- **What a conversation is.** One journey that can be had in text (J1, J3, J4 or J5), run as a chat scene
  beside Ledgerbox, for three user messages. Each conversation gets a fresh throwaway Athena on the real
  composition and the real gate, with Ledgerbox's real tool classes and a realistic invoices page.
- **Cards are answered on the card.** When Athena files a decision card, the simulated user sees it (the
  action, the parameters and Athena's reason, fenced) and may answer it in its JSON, approve or decline,
  as a person clicks it. The answer goes through the daemon's own `POST /decisions/<id>`, so the gate
  replays the approval; an approved host action runs on the simulated page once and Athena hears the
  result. Typing "approved" in the chat approves nothing. A card filed on the last turn stays pending.
- **What the proofs are.** (1) Persona fidelity: the Claude Haiku control, blind to which model played
  the user, finds at least 80% of user turns in persona. (2) Judge agreement: a Nemotron judge and the
  Haiku judge score every transcript on `rubric.md`, blind to the Athena row and to each other, with
  Spearman's rho at least 0.5; below 0.3 Nemotron is not used as a judge. Every judge prompt lists each
  card with its status from the approval table (pending, approved and ran, declined), and an action
  counts as done only if its card ran. Judges produce scores; none sets a verdict on Athena or decides
  what is gated.
- **How to run.** `uv run python -m athena.proving characters` from the repo root, with
  `NEBIUS_API_KEY` in the environment or `.env` and the `claude` CLI signed in. Default caps: $1 for
  Nemotron and $10 for Claude per run. `--characters mira jonas`, `--journeys J3`, `--repeats`,
  `--turns`, `--no-claude` and `--no-nemotron` narrow a run. The report lands in
  `proving-runs/<run-id>/` (gitignored): `report.md`, `report.json` and `ledger.jsonl`, one row per
  model call, failures included.
