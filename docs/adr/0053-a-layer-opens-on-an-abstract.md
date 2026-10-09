# 0053. A playbook's layer opens on an abstract, and each part opens one level down

Date: 2026-10-08

Amends ADR 0029 (a module is two layers) for the Playbooks module (ADR 0040). README section 14.

## Context

ADR 0029 gives a module two layers: an overview that reads, and a layer per item. The Playbooks
layer put everything a playbook has into two columns at once: the promise, the chore, the
command, the portals, the steps, the gates, the traps, what she learns, the proof with every card,
the trap ledger, the replay, her closing words, the runs, the lessons, the economics and the edge.
For the estate playbook that came to more than a dozen sections of prose before the first scroll.
The tiles carried the full promise as well, six lines each, so the grid read as a wall of text.
The owner's verdict was that the cards and the drawer had too much in them.

## Decision

- **A tile is a figure, not a paragraph.** It shows the rank, the domain, the verdict, the title,
  the value, and two chips: hours by hand → minutes with Athena, and the number of portals. The
  promise moves to the layer.
- **The layer opens on an abstract.** It shows the promise, a one-sentence caveat, the proof at a
  glance (money found against what was there, the verdict, claims right, traps avoided, her time
  against the hours by hand), and one row per part in two groups, *The chore* and *The proof*.
  Each row has a title, a one-line summary and a figure.
- **A part opens in place as the third level.** The parts are the chore and its command, the
  portals, the method, the gates, what she filed, the traps, the run, the lessons, and the money.
  The sheet's title becomes the part, and its eyebrow becomes the playbook. A strip of every part
  sits at the top, so moving sideways takes one click.
- **Back steps one level.** Back, Escape and the scrim go from a part to the abstract, and from the
  abstract they close the layer, all through the `Layer`'s single `onClose`.
- What the abstract lists is the model's pure `facetsOf(view)`, so it is tested without
  rendering. Only the parts a playbook has are listed: no gates row for a playbook without gates,
  and no run row without a trace.

## Consequences

- Nothing was removed. Every section from the old layer is one click from the abstract, and the
  full caveat stays under *The chore today*.
- Which part is open is view-local, like which layer is open (ADR 0029, decision 3). Opening
  another playbook resets it.
- The preview fixtures gain `open-run`, `open-traps`, `open-short-traps`, `open-short-proof` and
  `shipped-proof`, one for each opened part the tests read.
- The pattern belongs to this module for now. Connectors or Setup take it up only when one of
  their layers grows the same way.
