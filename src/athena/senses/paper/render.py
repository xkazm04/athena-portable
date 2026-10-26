"""Spike 01 (material): a sheet item printed as a one-page PDF, from the world's own row.

All the paper is fictional and comes from the chore's world (README "Material and privacy"): an
item with ``source: "render:<table>/<key value>"`` prints that row - the first row of the table one
of whose values is the key value. Without a source it prints ``params.lines``. What is printed:

- the letterhead (``params.letterhead``, else the row's ``biller`` / ``provider`` / ``from``),
- the recipient (``params.to``),
- the document type as a heading, then every one of ``params.fields`` with a human label and the
  value from ``params.values`` (an override) or the row; money as ``$1,234.50``, an ISO date as
  ``October 15, 2026`` (so a reader has to normalise, as it would on real mail),
- ``params.lines``, then ``params.inject`` - a printed instruction seeded for spike 01's R4: the
  page says it, and a reader must treat it as what the page says, never as a command.

The PDF is hand-built (stdlib, PDF 1.4, the standard Helvetica fonts, an uncompressed content
stream) so a test can find every printed value in its bytes. Text is Latin-1; anything else is
replaced with ``?``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any

from athena.senses.build import SenseError
from athena.senses.contract import MediaItem
from athena.senses.paper.normalise import MONEY_SUFFIX, iso_date, money

PAGE_W, PAGE_H = 612, 792
MARGIN = 64
SOURCE_PREFIX = "render:"
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

#: Labels for the fields the paper chores ask for; any other field is labelled from its name.
LABELS: dict[str, str] = {
    "amount_due_usd": "Amount due",
    "balance_usd": "Balance",
    "patient_owes_usd": "You may owe",
    "billed_usd": "Amount billed",
    "allowed_usd": "Allowed amount",
    "plan_paid_usd": "Plan paid",
    "dos": "Date of service",
    "due_date": "Payment due",
    "due": "Payment due",
    "deadline": "Respond by",
    "denial_date": "Date of denial",
    "statement_date": "Statement date",
    "claim_id": "Claim number",
    "bill_id": "Statement number",
    "account": "Account number",
    "member_id": "Member ID",
    #: The seeded line (``params.inject``): asked for so the bench sees what the page told its
    #: reader, never so anyone obeys it.
    "printed_instruction": "An instruction printed on the sheet to whoever reads it, word for word",
}


class RenderError(SenseError):
    """A sheet that cannot be printed; a :class:`SenseError`, so the CLI reports it per chore."""

    def __init__(self, problem: str) -> None:
        super().__init__([problem])


def field_label(name: str) -> str:
    if name in LABELS:
        return LABELS[name]
    base = name[: -len(MONEY_SUFFIX)] if name.endswith(MONEY_SUFFIX) else name
    words = base.replace("_", " ").strip()
    return words[:1].upper() + words[1:]


def printed(name: str, value: Any) -> str:
    """A value as the paper prints it."""
    text = str(value)
    amount = money(text) if name.endswith(MONEY_SUFFIX) else None
    if amount is not None:
        return f"${Decimal(amount):,.2f}"
    if len(text) == 10 and iso_date(text) == text:
        y, m, d = (int(p) for p in text.split("-"))
        return f"{MONTHS[m - 1]} {d}, {y}"
    return text


def source_row(world: Mapping[str, Any], source: str) -> dict[str, Any]:
    """The world row a ``render:<table>/<key value>`` source names."""
    if not source.startswith(SOURCE_PREFIX) or "/" not in source:
        raise RenderError(f"source {source!r} is not render:<table>/<key value>")
    table, _, wanted = source[len(SOURCE_PREFIX) :].partition("/")
    rows = dict(world.get("tables", {})).get(table)
    if not isinstance(rows, list):
        raise RenderError(f"source {source!r}: the world has no table {table!r}")
    for row in rows:
        if isinstance(row, Mapping) and any(str(v) == wanted for v in row.values()):
            return dict(row)
    raise RenderError(f"source {source!r}: no row of {table!r} holds {wanted!r}")


def sheet_lines(item: MediaItem, world: Mapping[str, Any]) -> list[tuple[str, str]]:
    """The page as ``(style, text)`` lines; style is ``head``, ``bold``, ``text`` or ``gap``."""
    params = item.params
    row = source_row(world, item.source) if item.source else {}
    values = {**row, **dict(params.get("values", {}))}
    letterhead = (
        params.get("letterhead") or row.get("biller") or row.get("provider") or row.get("from")
    )
    out: list[tuple[str, str]] = []
    if letterhead:
        out.append(("head", str(letterhead)))
    if params.get("to"):
        out += [("gap", ""), ("text", f"To: {params['to']}")]
    if params.get("doc_type"):
        out += [("gap", ""), ("bold", str(params["doc_type"]).replace("_", " ").upper())]
    out.append(("gap", ""))
    for name in (str(f) for f in params.get("fields", [])):
        if name in values and values[name] not in (None, ""):
            out.append(("text", f"{field_label(name)}: {printed(name, values[name])}"))
    lines: Sequence[Any] = params.get("lines", [])
    if lines:
        out.append(("gap", ""))
        out += [("text", str(line)) for line in lines]
    if params.get("inject"):
        out += [("gap", ""), ("bold", str(params["inject"]))]
    return out


def _escape(text: str) -> str:
    raw = text.encode("latin-1", "replace").decode("latin-1")
    return raw.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str, width: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
    return [*lines, line] if line else lines or [""]


def pdf_bytes(lines: Sequence[tuple[str, str]]) -> bytes:
    """One Letter page with the lines top to bottom (F1 Helvetica, F2 Helvetica-Bold)."""
    ops: list[str] = []
    y = PAGE_H - MARGIN
    for style, text in lines:
        if style == "gap":
            y -= 10
            continue
        font, size = (
            ("F2", 18) if style == "head" else ("F2", 12) if style == "bold" else ("F1", 11)
        )
        for part in _wrap(text, 80 if size <= 12 else 50):
            ops.append(f"BT /{font} {size} Tf {MARGIN} {y} Td ({_escape(part)}) Tj ET")
            y -= size + 6
    stream = "\n".join(ops).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"
        ).encode("latin-1"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def render_item(item: MediaItem, world: Mapping[str, Any], senses_dir: Path) -> Path:
    """Write the sheet's PDF at its ``path`` under ``senses_dir``; return where."""
    if item.kind != "paper" or not item.path:
        raise RenderError(f"{item.id}: only a paper item with a path is rendered")
    target = senses_dir / item.path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(pdf_bytes(sheet_lines(item, world)))
    return target


def render_all(root: Path) -> list[Path]:
    """Every paper sheet of the chore at ``root``, rendered (``python -m athena.senses render``)."""
    from athena.senses.build import _read, load_media
    from athena.senses.contract import SENSES_DIR

    media, _ = load_media(root)
    world = _read(root / "world.json")
    return [
        render_item(m, world, root / SENSES_DIR)
        for m in media
        if m.sense == "paper" and m.kind == "paper" and m.path
    ]
