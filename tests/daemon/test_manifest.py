"""``POST /manifest``: merged whole, refused whole, and never half (README §3.3).

Three claims, and each is about the *whole*: a merge replaces an origin's set in one assignment, a
refusal changes nothing at all, and the answer names the class the catalog gave every tool — which
is the catalog's answer and not the page's preference.
"""

from __future__ import annotations

from athena.daemon.server import AthenaDaemon

from .conftest import APP_ID, OTHER_APP_ID, OTHER_PAGE_ORIGIN, PAGE_ORIGIN, Live, manifest_body


def test_a_merged_manifest_answers_the_tool_list_with_the_class_of_each(live: Live) -> None:
    """``reversible`` and ``side_effects`` decide the class; nothing on the wire argues with it."""
    reply = live.register()

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert body["app_id"] == APP_ID
    assert body["origin"] == PAGE_ORIGIN
    assert body["registry_origin"] == f"host:{APP_ID}"
    assert body["conversation_id"] == "conv_invoices"
    assert body["tools"] == [
        {
            "name": "host.invoices.chase",
            "class": "AUTO",
            "origin": "host:invoices",
            "tier": 1,
        },
        {
            "name": "host.invoices.pay",
            "class": "GATED",
            "origin": "host:invoices",
            "tier": 1,
        },
    ]
    assert (body["showing"], body["total"], body["footer"]) == (2, 2, "")


def test_a_merge_opens_the_session_and_pins_the_app_to_its_origin(live: Live) -> None:
    """One act: the entries, the pin (policy rule 3) and the session all land together."""
    live.register()

    session = live.daemon.sessions.get(PAGE_ORIGIN)
    assert session is not None
    assert (session.app_id, session.tools) == (APP_ID, 2)
    assert live.daemon.gate.policy.pinned_origins == {APP_ID: PAGE_ORIGIN}
    assert live.request("/health").body["sessions"] == 1


def test_a_second_manifest_replaces_that_origins_previous_set(live: Live) -> None:
    """A page that re-registers is the page's new truth, not an addition to the old one."""
    live.register()
    reply = live.register(
        tools=[
            {
                "name": "archive",
                "reversible": True,
                "side_effects": "internal",
                "params_schema": {"type": "object", "properties": {}},
            }
        ]
    )

    assert reply.status == 200
    names = live.daemon.catalog.names()
    assert "host.invoices.archive" in names
    assert "host.invoices.pay" not in names, "the previous set survived a replacement"


def test_a_manifest_with_a_tool_that_does_not_declare_reversible_is_refused_whole(
    live: Live,
) -> None:
    """The refusal the module is built around: an omission read permissively is a tool that
    executes without a card, so the *manifest* is refused rather than the tool defaulted."""
    reply = live.request(
        "/manifest",
        method="POST",
        json_body=manifest_body(
            tools=[
                {"name": "chase", "side_effects": "internal"},
                {"name": "pay", "reversible": False, "side_effects": "external"},
            ]
        ),
    )

    assert reply.status == 400
    assert reply.body["reason"] == "manifest_invalid"
    assert any("reversible" in problem for problem in reply.body["problems"])
    assert live.daemon.catalog.names() == sorted(live.daemon.catalog.core)


def test_a_refused_manifest_leaves_the_origin_exactly_the_tools_it_had(live: Live) -> None:
    """The claim a half-merge would break: refused means refused, down to the last name."""
    live.register()
    before = live.daemon.catalog.names()

    refused = live.request(
        "/manifest",
        method="POST",
        json_body=manifest_body(
            tools=[
                {"name": "chase", "reversible": True, "side_effects": "internal"},
                {"name": "chase", "reversible": True, "side_effects": "none"},
            ]
        ),
    )

    assert refused.status == 400
    assert refused.body["reason"] == "manifest_invalid"
    assert any("duplicate" in problem for problem in refused.body["problems"])
    assert live.daemon.catalog.names() == before
    assert live.daemon.sessions.get(PAGE_ORIGIN) is not None


def test_a_page_that_names_no_origin_is_refused_because_the_origin_is_the_session(
    live: Live,
) -> None:
    reply = live.request("/manifest", method="POST", json_body=manifest_body(page_origin=""))

    assert reply.status == 400
    assert reply.body["reason"] == "manifest_invalid"
    assert any("page_origin" in problem for problem in reply.body["problems"])
    assert len(live.daemon.sessions) == 0


def test_a_page_origin_that_is_not_https_is_refused(live: Live) -> None:
    reply = live.request(
        "/manifest", method="POST", json_body=manifest_body(page_origin="http://invoices.example")
    )

    assert reply.status == 400
    assert any("https" in problem for problem in reply.body["problems"])


def test_two_origins_keep_two_sessions_and_two_pins(live: Live, daemon: AthenaDaemon) -> None:
    """A manifest belongs to one origin, so two pages are two sessions and never one."""
    live.register()
    live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN)

    assert len(daemon.sessions) == 2
    assert daemon.gate.policy.pinned_origins == {
        APP_ID: PAGE_ORIGIN,
        OTHER_APP_ID: OTHER_PAGE_ORIGIN,
    }
    assert "host.crm.pay" in daemon.catalog.names()
    assert "host.invoices.pay" in daemon.catalog.names()
