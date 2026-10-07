"""The Ledgerbox page a conversation happens on (README §9, §3.2 step 5; examples/ledgerbox).

Two things a real page gives Athena, here as data:

- :func:`host_state` — what the bridge posts as ``host_state`` every turn: the view, the
  invoices (three of them more than 30 days overdue, which is Mira's chore), the client inbox and
  the unmatched bank lines. Realistic enough that a chase has a right answer.
- :class:`SimulatedPage` — the page's answer to a host tool call. README §3.2 step 5: a host tool
  has no executor in the lane; the gate allows it, the lane emits ``tool.call``, the *surface*
  runs it on the page and the answer rides the next request. The desktop run loop
  (``apps/desktop/src/stores/run.ts``) does exactly that, with a fixed continuation line and a
  bound; :data:`CONTINUE` and the driver's bound are the same idea.

The page answers READ tools from the state and acknowledges reversible WRITE tools (a draft is
saved, nothing is sent). A ``GATED`` tool never reaches it: the gate turns that call into a card,
and the page only ever runs what the gate let through.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from athena.proving.manifests import LEDGERBOX_CLASSES, LEDGERBOX_ORIGIN

__all__ = ["CONTINUE", "SimulatedPage", "host_state"]

#: The continuation line, verbatim from ``apps/desktop/src/stores/run.ts``: the user has not said
#: anything new, so no words are put in their mouth.
CONTINUE = "(the tools you called have answered; continue)"

_INVOICES: list[dict[str, Any]] = [
    {
        "number": "INV-1031",
        "client": "Brightwater Coffee",
        "amount": "$2,400.00",
        "issued": "2026-08-12",
        "due": "2026-08-26",
        "days_overdue": 42,
        "state": "overdue",
        "reminders_sent": 1,
    },
    {
        "number": "INV-1036",
        "client": "Northwind Traders",
        "amount": "$4,200.00",
        "issued": "2026-08-20",
        "due": "2026-09-03",
        "days_overdue": 34,
        "state": "overdue",
        "reminders_sent": 0,
    },
    {
        "number": "INV-1037",
        "client": "Kestrel Books",
        "amount": "$860.00",
        "issued": "2026-08-22",
        "due": "2026-09-05",
        "days_overdue": 32,
        "state": "overdue",
        "reminders_sent": 2,
    },
    {
        "number": "INV-1041",
        "client": "Contoso Ltd",
        "amount": "$980.00",
        "issued": "2026-09-15",
        "due": "2026-09-29",
        "days_overdue": 8,
        "state": "overdue",
        "reminders_sent": 0,
    },
    {
        "number": "INV-1044",
        "client": "Fabrikam",
        "amount": "$1,750.00",
        "issued": "2026-09-30",
        "due": "2026-10-14",
        "state": "sent",
    },
    {
        "number": "INV-1029",
        "client": "Halvorsen Design Co",
        "amount": "$3,100.00",
        "issued": "2026-08-01",
        "state": "paid",
    },
]

_INBOX: list[dict[str, Any]] = [
    {
        "from": "ap@brightwater.example",
        "subject": "Re: INV-1031",
        "received": "2026-10-02",
        "body": (
            "Hi Mira, sorry this is late. Cash flow has been tight since the roaster broke. "
            "Could we pay half now and half on the 20th? — Sam, Brightwater"
        ),
    },
    {
        "from": "billing@contoso.example",
        "subject": "Remittance advice INV-1041",
        "received": "2026-10-05",
        "body": "Payment for INV-1041 is scheduled for Friday. Thanks, Contoso AP.",
    },
    {
        "from": "orders@kestrelbooks.example",
        "subject": "Change of billing contact",
        "received": "2026-09-28",
        "body": "Please send invoices to accounts@kestrelbooks.example from now on. — Lena",
    },
]

_BANK: list[dict[str, Any]] = [
    {"date": "2026-10-03", "payer": "BRIGHTWATER COFFEE", "amount": "$1,200.00", "matched": False},
    {"date": "2026-09-30", "payer": "HALVORSEN DESIGN", "amount": "$3,100.00", "matched": True},
]

_CLIENTS: list[dict[str, Any]] = [
    {
        "name": "Brightwater Coffee",
        "contact": "Sam Ortiz",
        "email": "ap@brightwater.example",
        "since": "2023",
        "terms": "net 14",
        "note": "friendly, small, pays eventually",
    },
    {
        "name": "Northwind Traders",
        "contact": "Dana Whitfield",
        "email": "accounts@northwind.example",
        "since": "2025",
        "terms": "net 14",
        "note": "largest account; formal tone",
    },
    {
        "name": "Kestrel Books",
        "contact": "Lena Moss",
        "email": "accounts@kestrelbooks.example",
        "since": "2024",
        "terms": "net 14",
        "note": "billing contact changed in September",
    },
    {
        "name": "Contoso Ltd",
        "contact": "Contoso AP",
        "email": "billing@contoso.example",
        "since": "2026",
        "terms": "net 14",
        "note": "AP department",
    },
]


def host_state() -> dict[str, Any]:
    """The page's state as the bridge posts it: Ledgerbox open on the invoices view."""
    return {
        "app": "Ledgerbox",
        "url": f"{LEDGERBOX_ORIGIN}/invoices",
        "view": "invoices",
        "today": "2026-10-07",
        "account": "Halden Studio",
        "invoices": [dict(row) for row in _INVOICES],
        "inbox": [dict(row) for row in _INBOX],
        "bank_lines": [dict(row) for row in _BANK],
    }


class SimulatedPage:
    """Answers the host calls the gate let through, the way Ledgerbox's page would."""

    def answer(self, name: str, params: Mapping[str, Any]) -> tuple[bool, str]:
        """``(ok, output)`` for one call. ``name`` may carry the ``host.ledgerbox.`` prefix."""
        tool = name.rsplit(".", 1)[-1]
        kind = LEDGERBOX_CLASSES.get(tool)
        if kind is None:
            return False, f"Ledgerbox has no tool named {tool!r}"
        if kind == "READ":
            return True, json.dumps(self._read(tool, params), ensure_ascii=False)
        if kind == "WRITE":
            if tool == "draft_reminder":
                return self._draft(params)
            what = str(params.get("invoice") or "")
            return True, f"{tool} done{f' for {what}' if what else ''}; nothing left the app"
        # A PERMANENT or outward tool reaches the page only after an approval; this world never
        # answers a card, so reaching here means the gate let one through. Say so, loudly.
        return False, f"{tool} reached the page without an approval"

    def _draft(self, params: Mapping[str, Any]) -> tuple[bool, str]:
        """Ledgerbox's ``draft_reminder`` answers with the WHOLE draft (``app/actions.ts``):
        ``to``, ``subject`` and ``body``, because half a message is not something a gate can
        approve. Nothing is sent."""
        wanted = str(params.get("invoice") or "").upper()
        invoice = next((row for row in _INVOICES if row["number"] == wanted), None)
        if invoice is None:
            return False, f"no invoice {wanted or '(none given)'}"
        client = next((c for c in _CLIENTS if c["name"] == invoice["client"]), None)
        if client is None:
            return False, f"no client record for {invoice['client']}"
        tone = str(params.get("tone") or "polite")
        first = str(client["contact"]).split()[0]
        body = (
            f"Hi {first},\n\nA quick reminder that {invoice['number']} for {invoice['amount']}, "
            f"due {invoice.get('due', '')}, is now {invoice.get('days_overdue', 0)} days overdue. "
            "Could you let me know when we can expect payment? If it is already on its way, "
            "thank you, and please ignore this note.\n\nBest,\nMira\nHalden Studio"
        )
        draft = {
            "reminder_id": f"rem_{invoice['number'].lower()}",
            "invoice": invoice["number"],
            "tone": tone,
            "to_name": client["contact"],
            "to": client["email"],
            "subject": f"Reminder: {invoice['number']} is overdue",
            "body": body,
        }
        message = f"Drafted a {tone} reminder for {client['email']}. Nothing has been sent."
        return True, json.dumps({"ok": True, "message": message, "draft": draft})

    def _read(self, tool: str, params: Mapping[str, Any]) -> Any:
        state = host_state()
        wanted = str(params.get("invoice") or "").upper()
        if tool == "read_inbox":
            return state["inbox"]
        if tool in ("read_invoice", "open_invoice", "open_item") and wanted:
            found = [row for row in state["invoices"] if row["number"] == wanted]
            return found[0] if found else {"error": f"no invoice {wanted}"}
        if tool == "read_books":
            return {"bank_lines": state["bank_lines"], "invoices": state["invoices"]}
        if tool == "read_clients":
            return _CLIENTS
        if tool == "read_credits":
            return []
        return {"view": state["view"], "invoices": state["invoices"]}
