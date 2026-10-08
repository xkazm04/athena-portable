"""Playbooks: a use case as data, and a bench that proves it on the gate (README §14; ADR 0040).

A playbook is a directory under ``playbooks/``: what the use case is worth and to whom
(``playbook.json``), the portals it happens in as data (``world.json``), what a perfect run would
file and what it must never file (``truth.json``, never shown to Athena), and the latest measured
run (``bench.json``). :mod:`.spec` reads and checks the four, :mod:`.page` answers the portals'
tools from the world's tables, and :mod:`.bench` drives a real Athena through them and scores the
cards she filed against the truth — read from the gate's records, never from her prose.
"""

from athena.proving.playbooks.spec import Playbook, PlaybookError, load_all, load_playbook

__all__ = ["Playbook", "PlaybookError", "load_all", "load_playbook"]
