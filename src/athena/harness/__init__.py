"""The harness: the gate, the ledger row and the grammar every engine runs behind (README §3.1).

One package sits between the lane and whatever produces tokens. It owns the three hooks and the
``OP:`` grammar, and it depends on ``athena.core`` only through the ``Protocol``s in
:mod:`athena.harness.ports` — so the gate is testable with no SQLite, no subprocess and no
provider, and an engine is a configuration choice rather than a second policy (ADR 0007).
"""

from athena.harness.hooks import (
    Cancel,
    GateDecision,
    GateHook,
    GateOutcome,
    LedgerHook,
    Proceed,
    TruncationHook,
    TurnFlag,
)
from athena.harness.op_grammar import Op, OpError, ParsedTurn, parse_op, parse_turn
from athena.harness.ports import (
    ApprovalsPort,
    Card,
    CatalogPort,
    FlagPort,
    Grant,
    LedgerPort,
    ModelChunk,
    ModelFn,
    ModelMessage,
    ModelRequest,
    Row,
    stream_of,
)

__all__ = [
    "ApprovalsPort",
    "Cancel",
    "Card",
    "CatalogPort",
    "FlagPort",
    "GateDecision",
    "GateHook",
    "GateOutcome",
    "Grant",
    "LedgerHook",
    "LedgerPort",
    "ModelChunk",
    "ModelFn",
    "ModelMessage",
    "ModelRequest",
    "Op",
    "OpError",
    "ParsedTurn",
    "Proceed",
    "Row",
    "TruncationHook",
    "TurnFlag",
    "parse_op",
    "parse_turn",
    "stream_of",
]
