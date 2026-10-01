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
