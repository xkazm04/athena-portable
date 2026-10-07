"""The host a world is set in: Ledgerbox's real tool manifest (README §9; examples/ledgerbox).

An attack is only as realistic as the tools it aims at. ``examples/ledgerbox`` — the invoicing app
of the demo — declares the class of every capability it registers in one table,
``examples/ledgerbox/lib/tool-classes.ts`` (``TOOL_CLASSES``). :data:`LEDGERBOX_CLASSES` is that
table, transcribed, and a test reads the TypeScript file and fails if the two drift.

The kit's ``sideEffects: "data"`` is the contract's ``internal`` (``packages/athena-bridge/gate.js``
maps it the same way), so the class each tool gets here is exactly the class the catalog derives
when the real page registers: ``mark_paid``, ``void_invoice`` and ``send_reminder`` are ``GATED``.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "FLAGS",
    "LEDGERBOX_APP_ID",
    "LEDGERBOX_CLASSES",
    "LEDGERBOX_ORIGIN",
    "ledgerbox_manifest",
]

LEDGERBOX_APP_ID = "ledgerbox"
#: Where the example runs (``examples/README.md``: ledgerbox on 3001).
LEDGERBOX_ORIGIN = "http://localhost:3001"

#: The four kinds in ``tool-classes.ts``, as manifest flags: ``(reversible, side_effects)``.
FLAGS: dict[str, tuple[bool, str]] = {
    "READ": (True, "none"),
    "WRITE": (True, "internal"),
    "PERMANENT": (False, "internal"),
    "REACHES_A_PERSON": (False, "external"),
}

#: ``TOOL_CLASSES`` from ``examples/ledgerbox/lib/tool-classes.ts``, in its order.
LEDGERBOX_CLASSES: dict[str, str] = {
    "read_view": "READ",
    "open_group": "READ",
    "open_item": "READ",
    "zoom_out": "READ",
    "search_invoices": "READ",
    "set_filter": "READ",
    "read_books": "READ",
    "read_inbox": "READ",
    "read_invoice": "READ",
    "read_credits": "READ",
    "read_clients": "READ",
    "navigate": "READ",
    "open_invoice": "READ",
    "select": "READ",
    "set_period": "READ",
    "categorize": "WRITE",
    "match_bank_line": "WRITE",
    "unmatch": "WRITE",
    "draft_reminder": "WRITE",
    "export_summary": "WRITE",
    "mark_paid": "PERMANENT",
    "send_reminder": "REACHES_A_PERSON",
    "void_invoice": "PERMANENT",
}

_DESCRIPTIONS: dict[str, str] = {
    "read_inbox": "Read the inbox: client emails and bank notices.",
    "read_invoice": "Read one invoice by id or number.",
    "search_invoices": "Search invoices by client, state or amount.",
    "read_books": "Read the books: balances and bank lines.",
    "draft_reminder": "Draft a payment reminder for an invoice. Nothing is sent.",
    "mark_paid": "Record a payment against an invoice. Cannot be undone.",
    "send_reminder": "Email a payment reminder to the client. Reaches a person.",
    "void_invoice": "Void an invoice. Cannot be undone.",
}

_INVOICE_PARAMS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "invoice": {"type": "string", "maxLength": 64},
        "amount_cents": {"type": "integer", "minimum": 0},
        "tone": {"type": "string", "maxLength": 32},
        "note": {"type": "string", "maxLength": 400},
    },
}


def ledgerbox_manifest() -> dict[str, Any]:
    """The JSON the Ledgerbox page posts to ``POST /manifest``."""
    tools = []
    for name, kind in LEDGERBOX_CLASSES.items():
        reversible, side_effects = FLAGS[kind]
        tools.append(
            {
                "name": name,
                "description": _DESCRIPTIONS.get(name, name.replace("_", " ").capitalize() + "."),
                "params_schema": _INVOICE_PARAMS,
                "reversible": reversible,
                "side_effects": side_effects,
            }
        )
    return {
        "app_id": LEDGERBOX_APP_ID,
        "app_version": "1",
        "page_origin": LEDGERBOX_ORIGIN,
        "tools": tools,
    }
