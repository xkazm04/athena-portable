# 0044. A handed-over playbook is the active project on every turn

Date: 2026-10-07

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md); uses the turn frame's
active-project block of [0006](0006-two-output-prompt-composer.md). Found by the medical-bills
playbook.

## Context

A playbook spans portals, and a turn is pinned to one (README §3.4). So a playbook runs as a
sequence of tabs, and in each tab the person says only that tab's part: "compare these bills",
"same thing here". The whole goal was said once, at the start, in another tab's conversation.

The third medical-bills bench showed what that loses. In the insurer's tab Athena noted that the
MRI appeal needed "the visit notes … in MyChart". In MyChart the person talked about bills, and she
worked the bills; she never read the therapy notes while she was in the one tab that had them. Back
at the insurer she could not, and rightly refused to spend the one internal appeal without them:
$1,240 left on the table by a goal she had stopped seeing.

The turn frame already renders the person's active project, unfenced, on every turn
(`frame.project`); the daemon takes it as `active_project` on `POST /run`. Nothing sent one.

## Decision

1. **Handing a playbook to Athena makes it her active project.** The Playbooks module's "Hand it
   to Athena" sends the playbook's id and title with the command (`athena:offer`); her window keeps
   it in the run store and sends `active_project: {kind: "playbook", id, title, goal}` — the goal
   being the playbook's command — with every turn, in every tab.
2. **It is the person's selection.** A chip above her composer names it, with "done" to clear it.
   Clearing the conversation does not clear it. It is not fenced, as the frame's project never was:
   it is the person's own words, chosen by them, not a page's.
3. **The bench runs a playbook the same way**: every turn of every phase carries the playbook's
   title and goal as the active project.

## Consequences

- In each tab she sees what the whole run is for, so she can gather what a later step will need
  while she is where it lives.
- A goal can be stale: a person who moves on without pressing "done" keeps sending it. The chip is
  the remedy, and it is on every screen of her Talk tab.
- Tests: the run store sends the active project on every turn until cleared, and Clear keeps it;
  the companion names it; the bench's every turn carries it.
