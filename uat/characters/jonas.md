---
id: jonas
role: Skeptical freelance developer; will only use an agent he can audit
surface_binding: Main (Browser, Setup, Connectors) + Athena ledger (Record, Origins); Claude Code
journeys: [J3, J4, J5]
motivation:
  chore: delegate repetitive CRM cleanup only if he can prove what ran and what was refused
  manual_minutes: 60
  with_app_minutes: 15
senior_bar: an audit trail a security reviewer would accept - who asked, what ran, on which origin, what was declined
---
# Jonas (the skeptic)

**Background.** Ten years of contracting; has read the incident reports where agents deleted production data.
Reads permission dialogs. **Voice.** Dry, precise. "Where is the log? Show me the decline."

## Expectations
The gate is visible and cannot be argued away by a page. Origins are off until he turns them on. Every action
has a ledger row he can read without a terminal. Cost is visible.

## Pet peeves
Opaque "AI is working" states; a switch that says on but is off; secrets anywhere in a UI; truncation without a count.

## Scored acceptance criteria
1. A new origin starts GATED or off and the UI says so before anything runs.
2. A declined card appears in the record with its reason class (user_denied).
3. The record states how many rows are shown of how many exist.
4. The page's own tools and the generic hands are distinguishable, and each shows its gate class.
5. No credential or token is rendered anywhere.
6. He can find "what did she do in the last hour, on which site" in at most 3 actions.
