"""ADR 0097: the Adopt studio — adopting a playbook is a conversation, not a form.

A session lives in daemon memory outside the turn lock (:mod:`.session`); slots are derived from
the playbook and filled by the person's answers, an auditor and research lanes (:mod:`.slots`);
every model call goes through one door that names its kind (:mod:`.legs`); the round loop asks,
audits and writes the brief (:mod:`.loop`); the HTTP surface is :mod:`.routes`. The wire shapes
are the contract in :mod:`athena.contracts.adopt`.
"""

from __future__ import annotations

from athena.adopt.legs import LegResult, LegRunner, WarmSession, cli_argv, load_tiers
from athena.adopt.session import (
    AdoptSession,
    Hooks,
    IntakeSession,
    SessionStore,
    current_hooks,
    register_hooks,
    reset_hooks,
)
from athena.adopt.slots import PlaybookMissing, load_playbook_json, mechanical_slots, playbooks_root

__all__ = [
    "AdoptSession",
    "Hooks",
    "IntakeSession",
    "LegResult",
    "LegRunner",
    "PlaybookMissing",
    "SessionStore",
    "WarmSession",
    "cli_argv",
    "current_hooks",
    "load_playbook_json",
    "load_tiers",
    "mechanical_slots",
    "playbooks_root",
    "register_hooks",
    "reset_hooks",
]
