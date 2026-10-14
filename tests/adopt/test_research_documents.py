"""A dropped document reaches the studio past the daemon's 1 MiB JSON cap, on its route alone
(ADR 0097): a 10 MB document is a ~13.4 MB base64 body."""

from __future__ import annotations

import base64

from athena.adopt.documents import DOCUMENT_BODY_BYTES
from athena.daemon.server import MAX_BODY_BYTES

from .conftest import PLAYBOOK_ID, Live


def start(live: Live) -> str:
    status, body = live.request("/adopt", method="POST", body={"playbook_id": PLAYBOOK_ID})
    assert status == 200, body
    return str(body["session_id"])


def test_a_document_past_one_mib_is_accepted_on_the_documents_route(live: Live) -> None:
    sid = start(live)
    data = base64.b64encode(b"x" * (3 * 1024 * 1024)).decode()
    status, body = live.request(
        f"/adopt/{sid}/documents",
        method="POST",
        body={"name": "big.txt", "mime": "text/plain", "data_b64": data},
        timeout=30,
    )
    assert status == 200 and body["doc_id"] == "doc1", body


def test_the_other_adopt_routes_keep_the_one_mib_cap(live: Live) -> None:
    sid = start(live)
    status, body = live.request(
        f"/adopt/{sid}/answer",
        method="POST",
        body={"answers": [], "pad": "y" * (MAX_BODY_BYTES + 1024)},
        timeout=30,
    )
    assert (status, body["reason"]) == (400, "parse_error")


def test_a_body_past_the_documents_cap_is_refused(live: Live) -> None:
    sid = start(live)
    status, body = live.request(
        f"/adopt/{sid}/documents",
        method="POST",
        body={"name": "huge.txt", "mime": "text/plain", "data_b64": "A" * DOCUMENT_BODY_BYTES},
        timeout=60,
    )
    assert (status, body["reason"]) == (400, "parse_error")


def test_the_cap_covers_ten_megabytes_of_base64() -> None:
    from athena.adopt.routes import DOCUMENT_CAP

    envelope = len('{"name": "", "mime": "", "data_b64": ""}') + 200
    assert (DOCUMENT_CAP * 4) // 3 + 4 + envelope < DOCUMENT_BODY_BYTES
