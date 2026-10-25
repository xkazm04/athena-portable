"""The closed failure vocabulary, in a module of its own (README §2 invariant 6).

``ERROR_REASONS`` names why anything in this repository failed: a turn (``TurnResult``, the
ledger's ``error_reason`` column, ``turn.error``), a refusal at the bridge, and a tool's own
failure (``ToolResult.reason``, ``ExecResult.reason``). It lives here rather than in
``harness.py`` because ``channel.py`` reads it and ``harness.py`` imports ``channel.py``: one
import direction, one vocabulary. ``harness`` and the package re-export the same objects, so every
older import keeps working.

A failure's detail is free text beside its reason, and it is page-written as often as not, so it
is bounded too: :data:`ERROR_DETAIL_CAP` is the cut the frame applies to it, with the announced
``(showing N of M)`` footer (README §2 invariant 4).
"""

from __future__ import annotations

#: The one closed vocabulary for ``TurnResult.error_reason``, the ledger's ``error_reason``
#: column, ``turn.error``'s ``reason``, the bridge's refusals and a tool result's ``reason``. It
#: lives in ``contracts`` because it is a seam: ``core`` stores it, ``harness`` and the bridge
#: produce it, and neither imports the other. Low cardinality is the design — a reason you cannot
#: group by is a log line, not a column — so a new member is a deliberate change with a test, not
#: a new string at a call site.
ERROR_REASONS: tuple[str, ...] = (
    # the user, at the gate
    "user_denied",
    "expired",
    "pending_approval",
    # policy refused the call before anything ran
    "foreign_origin",
    "foreign_token",
    "unknown_ref",
    "validator_failed",
    "manifest_invalid",
    "approval_spent",
    # the turn could not finish
    "budget_exhausted",
    "engine_error",
    "timeout",
    "parse_error",
    "cancelled",
    # the turn ran and came back blank (ADR 0143): the engine said nothing and called nothing, or
    # the plan's usage limit stopped it - counted apart from engine_error, as runs that cost a turn
    # and left nothing behind
    "no_answer",
    "usage_limit",
    # the call was sent and its answer never came: it may have run (ADR 0101)
    "outcome_unknown",
    # the catch-all; anything unrecognised collapses here rather than inventing a column value
    "unknown",
)

#: How much of one tool failure's free-text detail reaches the frame and the record: the same
#: 240 characters a catalog tool's description is capped to, because a detail is a sentence and
#: not a page. The reason carries the category; the detail only has to say which instance.
ERROR_DETAIL_CAP = 240


def normalize_reason(reason: str | None) -> str | None:
    """Map any string onto :data:`ERROR_REASONS`; ``None`` stays ``None``.

    ``None`` is the successful row and must survive, which is why this is not ``-> str``. Anything
    else that is not a member becomes ``"unknown"``: a reason invented at a call site would be a
    ledger column with unbounded cardinality, and the row would still not say why.
    """
    if reason is None:
        return None
    lowered = reason.strip().lower()
    return lowered if lowered in ERROR_REASONS else "unknown"


def reason_of_error(error: str | None) -> str:
    """The reason a legacy error text names, for a failure that arrived without one.

    Before a tool failure had a ``reason`` field, a writer put the reason in the error itself:
    the whole text (``"unknown_ref"``) or its prefix before a colon (``"outcome_unknown: send did
    not answer"``). That leading token, exactly as written, is the reason when it is a member.
    Anything else — a page's own sentence, an empty error — is ``"unknown"``: free text is never
    read into the vocabulary by guessing at its words.
    """
    head = (error or "").split(":", 1)[0].strip()
    return head if head in ERROR_REASONS else "unknown"
