"""``POST /manifest``: a page enters the catalog, whole or not at all (README §3.3).

The class is the catalog's answer and never the page's preference: ``AUTO`` only for a tool the
manifest itself calls reversible and not externally visible, ``GATED`` for everything else. A
manifest that fails validation is refused whole — the origin keeps exactly the tools it had — and
the same page can register again straight afterwards.
"""

from __future__ import annotations

from .conftest import APP_ID, PAGE_ORIGIN, Spawn, manifest_body


def test_a_page_registers_two_tools_and_the_catalog_derives_the_class_of_each(
    spawn: Spawn,
) -> None:
    daemon = spawn.real()
    before = daemon.request("/health").body["tools"]

    reply = daemon.register()

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert body["app_id"] == APP_ID
    assert body["origin"] == PAGE_ORIGIN
    assert body["registry_origin"] == f"host:{APP_ID}"
    assert body["conversation_id"] == f"conv_{APP_ID}"
    assert body["tools"] == [
        {
            "name": f"host.{APP_ID}.chase",
            "class": "AUTO",
            "origin": f"host:{APP_ID}",
            "tier": 1,
        },
        {
            "name": f"host.{APP_ID}.pay",
            "class": "GATED",
            "origin": f"host:{APP_ID}",
            "tier": 1,
        },
    ]
    # The bounded shape every read answers in, and this page is the whole population of it.
    assert (body["showing"], body["total"], body["footer"]) == (2, 2, "")
    assert daemon.request("/health").body["tools"] == before + 2


def test_a_manifest_that_omits_reversible_is_refused_whole_and_leaves_the_catalog_alone(
    spawn: Spawn,
) -> None:
    """``reversible`` is ``None`` until the host says so, and the omission is refused rather than
    read as a default — the permissive reading is a tool that executes without a card."""
    daemon = spawn.real()
    good = daemon.register()
    assert good.status == 200
    settled = daemon.request("/health").body["tools"]

    body = manifest_body()
    del body["tools"][0]["reversible"]
    refused = daemon.request("/manifest", method="POST", json_body=body)

    assert refused.status == 400
    assert refused.body["ok"] is False
    assert refused.body["reason"] == "manifest_invalid"
    assert refused.body["app_id"] == APP_ID
    assert refused.body["detail"] == f"manifest {APP_ID!r} is refused whole"
    assert any("reversible" in problem for problem in refused.body["problems"])
    # Refused whole: not one of its tools landed, and the ones already there are untouched.
    assert daemon.request("/health").body["tools"] == settled

    again = daemon.register()
    assert again.status == 200
    assert [tool["class"] for tool in again.body["tools"]] == ["AUTO", "GATED"]
    assert daemon.request("/health").body["tools"] == settled
