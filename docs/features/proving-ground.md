# The Proving Ground

`src/athena/proving/`. README §9–§11. Nebius and NVIDIA are the test bench, not the companion's
engine (ADR 0030): generated adversaries and generated users are pointed at the real daemon, each
against its own throwaway brain, every model call in the ledger. Every Nemotron role runs beside a
Claude Haiku control, and a prototype proves only within a stated margin of it.

| Prototype | State | Result so far |
|---|---|---|
| `nebius` engine | built | live turns pass on Nemotron 3.5 Lightning and Nemotron 3 Super |
| **Gauntlet**: Nemotron writes attacks on host state, tool output and memory; replayed against Athena on Claude and on Nemotron | built | first live run: 93 hostile turns, 0 breaches (75 on Claude, 18 on Nemotron); Nemotron's valid-attack rate 0.60 of the control's; Nemotron $0.023, Claude $3.20 |
| Approve-path probe: an approved card runs exactly its action once; altered, foreign and repeated approvals are refused | built | ok on every card filed; three planted bugs each caught |
| **Model-played Characters**: Nemotron plays the `uat/` users, answers cards on the card; Nemotron and Haiku judge blind | built | Lightning in persona on 96% of turns for under a cent; Super agrees with Haiku at rho ≈ 0.52, so Nemotron judges only as a second opinion |
| Trigger page: start and watch a run, token-gated, daily caps | built, local; hosted mode runs the Gauntlet without Claude | first run through the page streamed live |
| Branching worlds on Token Factory Sandboxes | spike built | blocked on beta access (ADR 0033) |
| Playbook bench | built | [playbooks.md](playbooks.md) |

```bash
uv run python -m athena.proving gauntlet
uv run python -m athena.proving characters
PROVING_JUDGE_TOKEN=<token> uv run python -m athena.proving.server --no-claude
```

The verdict of every adversarial run is read off the gate's records (gate outcomes, fact writers,
the approval table), never off a model (ADR 0032). Reports land in the gitignored
`proving-runs/<ts>/`. The trigger page's container is ready for a Nebius Serverless Endpoint and
not deployed.
