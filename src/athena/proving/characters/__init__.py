"""Model-played Characters: Nemotron plays the ``uat/`` users (README §9; uat/README, LC level).

The ``uat`` skill's conversation level (LC) drives the real agent instrument in text against
model-played users. This prototype is that level for Athena, run at volume on Token Factory:

- :mod:`.persona` — a Character from ``uat/characters`` (frontmatter and body) becomes a
  user-simulator system prompt; a journey from ``uat/journeys`` becomes the goal of one
  conversation. The juror is excluded: an evaluator, not a user.
- :mod:`.scene` — the Ledgerbox page the conversation happens on: realistic host state, and the
  page's answers to the READ tools Athena calls, exactly as the desktop run loop carries them.
- :mod:`.judges` — the persona-fidelity judge (the Haiku control, blind) and the rubric judges
  (Nemotron on its ladder and Haiku, blind to the Athena row and to each other), plus the stdlib
  Spearman the agreement proof is read from.
- :mod:`.run` — the run: conversations on both Athena rows, the two proofs, one escalation per
  role, the report.

A judge produces scores. It never sets a verdict on Athena and never decides whether anything is
gated: the catalog classifies and the gate decides (README §2, invariant 3).
"""

from __future__ import annotations

__all__: list[str] = []
