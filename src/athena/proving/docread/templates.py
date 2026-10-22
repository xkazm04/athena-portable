"""WP-V (nvidia-revisit): the three document templates, plain HTML filled from sheet text only.

No model writes a word of these. The only text not taken from a scenario is fixed furniture (a
letterhead, a table header) and reference numbers derived from a checksum of the scenario id.
"""

from __future__ import annotations

import html
import zlib
from dataclasses import dataclass

__all__ = ["KINDS", "Statement", "render_html"]

#: The three document kinds, in the order facts are dealt to them.
KINDS: tuple[str, ...] = ("letter", "statement", "notice")

_STREETS = ("Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir", "Hawthorn", "Juniper", "Linden")
_TOWNS = (
    "Springfield, OR 97477",
    "Fairview, MN 55021",
    "Georgetown, TX 78626",
    "Clinton, IA 52732",
    "Salem, NH 03079",
)

_CSS = """\
@page { size: 794px 1123px; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff }
body { width: 794px; height: 1123px; overflow: hidden; color: #1c1c1c;
  font: 14px/1.5 Georgia, 'Times New Roman', serif }
.page { padding: 56px 64px; height: 100% }
.head { display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 3px solid #1f3a5f; padding-bottom: 10px; margin-bottom: 26px }
.org { font: 700 22px/1.1 Arial, Helvetica, sans-serif; color: #1f3a5f; letter-spacing: .02em }
.sub { font: 12px/1.3 Arial, Helvetica, sans-serif; color: #555; text-align: right }
.addr { margin: 0 0 22px; white-space: pre-line }
.meta { font: 12px/1.4 Arial, Helvetica, sans-serif; color: #444; margin-bottom: 18px }
h1 { font: 700 17px/1.3 Arial, Helvetica, sans-serif; margin: 0 0 14px }
p { margin: 0 0 12px }
table { border-collapse: collapse; width: 100%; margin: 6px 0 18px;
  font: 13px/1.4 Arial, Helvetica, sans-serif }
th { text-align: left; background: #e8edf3; border: 1px solid #9aa7b6; padding: 6px 8px }
td { border: 1px solid #b7c0cb; padding: 6px 8px; vertical-align: top }
td.n { white-space: nowrap; color: #555 }
.band { background: #7a1f1f; color: #fff; font: 700 15px/1 Arial, Helvetica, sans-serif;
  letter-spacing: .12em; padding: 10px 14px; margin: -56px -64px 24px }
ul { margin: 0 0 16px; padding-left: 20px } li { margin-bottom: 8px }
.foot { position: absolute; left: 64px; right: 64px; bottom: 48px;
  font: 11px/1.4 Arial, Helvetica, sans-serif; color: #666;
  border-top: 1px solid #ccc; padding-top: 8px }
"""


@dataclass(frozen=True)
class Statement:
    """One fact-sheet entry as a document states it: ``about`` is the label, ``text`` the truth."""

    entry_id: str
    about: str
    text: str


def render_html(
    kind: str, scenario_id: str, person: str, title: str, statements: list[Statement]
) -> str:
    """The document of ``kind`` stating ``statements``. Same arguments, same bytes."""
    if kind not in KINDS:
        raise ValueError(f"no template for {kind!r}")
    seed = zlib.crc32(f"{scenario_id}/{kind}".encode())
    name = person.split(",")[0].strip()
    street = _STREETS[seed % len(_STREETS)]
    number = 100 + seed % 800
    town = _TOWNS[(seed >> 3) % len(_TOWNS)]
    address = f"{name}\n{number} {street} Street\n{town}"
    ref = f"{seed % 90000 + 10000}"
    body = {"letter": _letter, "statement": _statement, "notice": _notice}[kind](
        _e(title), _e(name), address, ref, statements
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f"<title>{_e(title)}</title><style>{_CSS}</style></head><body>{body}</body></html>\n"
    )


def _e(text: str) -> str:
    return html.escape(text, quote=True)


def _letter(title: str, name: str, address: str, ref: str, statements: list[Statement]) -> str:
    paragraphs = (
        "".join(f"<p><b>{_e(_cap(s.about))}.</b> {_e(s.text)}</p>" for s in statements)
        or "<p>I have nothing further to add to my file at this time.</p>"
    )
    return (
        '<div class="page">'
        f'<div class="head"><div class="org">{title}</div>'
        '<div class="sub">Correspondence Desk<br>PO Box 4410</div></div>'
        f'<div class="meta">Our reference {ref}-L &nbsp;|&nbsp; 3 March 2026</div>'
        f'<div class="addr">{_e(address)}</div>'
        f"<h1>Re: your case file {ref}</h1>"
        f"<p>Dear {name},</p>"
        "<p>Thank you for your recent contact. This letter records what is on your file, in your "
        "own words, so that it can be checked against our records.</p>"
        f"{paragraphs}"
        "<p>If anything above is wrong, please tell us before the file is next reviewed.</p>"
        "<p>Yours sincerely,<br><br>Case Administration</p>"
        "</div>"
    )


def _statement(title: str, name: str, address: str, ref: str, statements: list[Statement]) -> str:
    rows = (
        "".join(
            f'<tr><td class="n">{ref}-{i:02d}</td><td>{_e(_cap(s.about))}</td>'
            f"<td>{_e(s.text)}</td></tr>"
            for i, s in enumerate(statements, 1)
        )
        or '<tr><td class="n">-</td><td colspan="2">No entries this period.</td></tr>'
    )
    return (
        '<div class="page">'
        f'<div class="head"><div class="org">{title}</div>'
        '<div class="sub">Account Statement<br>Page 1 of 1</div></div>'
        f'<div class="meta">Statement {ref}-S &nbsp;|&nbsp; Period ending 28 February 2026</div>'
        f'<div class="addr">{_e(address)}</div>'
        f"<h1>Statement of record for {name}</h1>"
        "<table><thead><tr><th>Line</th><th>Item</th><th>Detail as recorded</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
        "<p>Entries are shown as recorded on the account holder's file. "
        "This is not a bill; no payment is due.</p>"
        '<div class="foot">Keep this statement with your records.</div>'
        "</div>"
    )


def _notice(title: str, name: str, address: str, ref: str, statements: list[Statement]) -> str:
    items = (
        "".join(f"<li><b>{_e(_cap(s.about))}:</b> {_e(s.text)}</li>" for s in statements)
        or "<li>No matters are open on this file.</li>"
    )
    return (
        '<div class="page">'
        '<div class="band">NOTICE OF RECORD</div>'
        f'<div class="head"><div class="org">{title}</div>'
        f'<div class="sub">Agency copy<br>Notice {ref}-N</div></div>'
        f'<div class="meta">Issued 9 March 2026 &nbsp;|&nbsp; Case {ref}</div>'
        f'<div class="addr">{_e(address)}</div>'
        f"<h1>Notice to {name}</h1>"
        "<p>Our records for the above case show the following:</p>"
        f"<ul>{items}</ul>"
        "<p>This notice is issued for your information. You may ask for a review "
        "within thirty days of the date above.</p>"
        "</div>"
    )


def _cap(text: str) -> str:
    text = text.strip().rstrip(".")
    return text[:1].upper() + text[1:]
