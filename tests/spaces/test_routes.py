"""The ``/spaces`` routes over a real daemon, key for key with the contract (ADR 0225).

spaces/routes.py, adopt/routes.py (``POST /adopt/cases/<proj>/space``). A project is made, listed,
patched and erased; a chore linked to it is counted and goes back to core when it is erased; a
project a turn is running in cannot be erased under it.
"""

from __future__ import annotations

from typing import Any

from athena.adopt.cases import render_case
from athena.contracts import ids
from athena.contracts.adopt import Case
from athena.contracts.channel import now_iso
from athena.contracts.spaces import APPS_CAP, BRIEF_CAP, NAME_CAP
from athena.daemon.server import AthenaDaemon

from .conftest import Live

SUMMARY_KEYS = {"id", "name", "brief", "apps", "hue", "created", "updated", "counts"}
COUNT_KEYS = {"episodes", "facts", "procedurals", "chores"}
ERASED_KEYS = {"id", "episodes", "facts", "procedurals", "chores_unlinked"}


def saved_case(daemon: AthenaDaemon, space_id: str = "") -> str:
    """A saved case, as an approve writes it (ADR 0123), filed under ``space_id``."""
    case_id = ids.mint("project")
    stamp = now_iso()
    case = Case(
        id=case_id,
        playbook_id="invoice-chase",
        title="Chase the invoices",
        approved_rev=1,
        approved_at=stamp,
        episode_id="",
        created=stamp,
        brief_md="Chase every overdue invoice.",
        command="Chase every overdue invoice.",
        space_id=space_id,
    )
    daemon.brain.write_goal(
        case_id,
        case.title,
        render_case(case),
        session_id=ids.conversation_for_project(case_id),
        created=stamp,
    )
    return case_id


def create(live: Live, **body: Any) -> dict[str, Any]:
    reply = live.request("/spaces", method="POST", json_body={"name": "Taxes 2026", **body})
    assert reply.status == 201, reply.body
    return reply.body


def case_row(live: Live, case_id: str) -> dict[str, Any]:
    reply = live.request("/adopt/cases")
    assert reply.status == 200
    (row,) = [row for row in reply.body["cases"] if row["case_id"] == case_id]
    return dict(row)


def test_a_project_round_trips_create_list_patch_erase_with_the_contract_keys(live: Live) -> None:
    made = create(live, brief="File the return.", apps=["https://tax.example"], hue=40)
    assert set(made) == SUMMARY_KEYS and set(made["counts"]) == COUNT_KEYS
    assert ids.is_id("space", made["id"])
    assert (made["name"], made["brief"], made["apps"], made["hue"]) == (
        "Taxes 2026",
        "File the return.",
        ["https://tax.example"],
        40,
    )
    assert made["counts"] == {"episodes": 0, "facts": 0, "procedurals": 0, "chores": 0}
    other = create(live, name="Garden")

    listed = live.request("/spaces")
    assert listed.status == 200 and set(listed.body) == {"spaces"}
    # Most recently updated first.
    assert [s["id"] for s in listed.body["spaces"]] == [other["id"], made["id"]]
    assert all(set(s) == SUMMARY_KEYS for s in listed.body["spaces"])

    one = live.request(f"/spaces/{made['id']}")
    assert one.status == 200 and one.body == made

    patched = live.request(
        f"/spaces/{made['id']}", method="POST", json_body={"brief": "File it by April."}
    )
    assert patched.status == 200 and set(patched.body) == SUMMARY_KEYS
    assert patched.body["brief"] == "File it by April." and patched.body["name"] == "Taxes 2026"
    assert patched.body["updated"] >= made["updated"]
    assert live.request("/spaces").body["spaces"][0]["id"] == made["id"]

    erased = live.request(f"/spaces/{made['id']}", method="DELETE")
    assert erased.status == 200 and set(erased.body) == ERASED_KEYS
    assert erased.body == {
        "id": made["id"],
        "episodes": 0,
        "facts": 0,
        "procedurals": 0,
        "chores_unlinked": 0,
    }
    assert live.request(f"/spaces/{made['id']}").status == 404
    assert [s["id"] for s in live.request("/spaces").body["spaces"]] == [other["id"]]


def test_every_cap_is_refused_400_bad_request_naming_it(live: Live) -> None:
    def refused(path: str, body: dict[str, Any]) -> str:
        reply = live.request(path, method="POST", json_body=body)
        assert reply.status == 400, reply.body
        assert reply.body["error"] == "bad_request"
        assert reply.body["reason"] == "validator_failed"
        return str(reply.body["detail"])

    assert "name" in refused("/spaces", {})
    assert str(NAME_CAP) in refused("/spaces", {"name": "x" * (NAME_CAP + 1)})
    assert str(BRIEF_CAP) in refused("/spaces", {"name": "a", "brief": "b" * (BRIEF_CAP + 1)})
    many = [f"https://app{n}.example" for n in range(APPS_CAP + 1)]
    assert str(APPS_CAP) in refused("/spaces", {"name": "a", "apps": many})
    assert "origin" in refused("/spaces", {"name": "a", "apps": ["https://a.example/path"]})
    assert "hue" in refused("/spaces", {"name": "a", "hue": -1})
    made = create(live)
    assert "name" in refused(f"/spaces/{made['id']}", {"name": ""})
    assert live.request("/spaces").body["spaces"] == [made]


def test_an_unknown_or_ill_formed_project_is_404_unknown_ref(live: Live) -> None:
    for space_id in ("spc_0123456789ab", "spc_nothex", "core"):
        for method in ("GET", "DELETE"):
            reply = live.request(f"/spaces/{space_id}", method=method)
            assert reply.status == 404 and reply.body["reason"] == "unknown_ref", space_id
        patch = live.request(f"/spaces/{space_id}", method="POST", json_body={"name": "x"})
        assert patch.status == 404


def test_a_linked_chore_is_counted_and_goes_back_to_core_when_its_project_is_erased(
    live: Live, daemon: AthenaDaemon
) -> None:
    made = create(live)
    case_id = saved_case(daemon)
    assert case_row(live, case_id)["space_id"] == ""

    linked = live.request(
        f"/adopt/cases/{case_id}/space", method="POST", json_body={"space_id": made["id"]}
    )
    assert linked.status == 200, linked.body
    assert linked.body["case_id"] == case_id and linked.body["space_id"] == made["id"]
    assert case_row(live, case_id)["space_id"] == made["id"]
    assert live.request(f"/spaces/{made['id']}").body["counts"]["chores"] == 1

    erased = live.request(f"/spaces/{made['id']}", method="DELETE")
    assert erased.status == 200 and erased.body["chores_unlinked"] == 1
    # The chore survives, back in core.
    assert case_row(live, case_id)["space_id"] == ""


def test_a_chore_is_unlinked_with_an_empty_space_and_a_stranger_space_is_refused(
    live: Live, daemon: AthenaDaemon
) -> None:
    made = create(live)
    case_id = saved_case(daemon, made["id"])
    assert case_row(live, case_id)["space_id"] == made["id"]

    def link(case: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        reply = live.request(f"/adopt/cases/{case}/space", method="POST", json_body=body)
        return reply.status, reply.body

    status, body = link(case_id, {"space_id": "spc_0123456789ab"})
    assert (status, body["reason"]) == (400, "unknown_ref") and "no such space" in body["detail"]
    status, body = link(case_id, {"space_id": "spc_nothex"})
    assert (status, body["reason"]) == (400, "unknown_ref") and "not a space id" in body["detail"]
    assert link(case_id, {})[0] == 400
    assert link("proj_0123456789ab", {"space_id": made["id"]})[0] == 404
    assert case_row(live, case_id)["space_id"] == made["id"]

    status, body = link(case_id, {"space_id": ""})
    assert status == 200 and body["space_id"] == ""
    assert case_row(live, case_id)["space_id"] == ""


def test_a_project_a_turn_runs_in_cannot_be_erased_under_it(
    live: Live, daemon: AthenaDaemon
) -> None:
    made = create(live)
    with daemon.in_space(made["id"]) as entered:
        assert entered
        busy = live.request(f"/spaces/{made['id']}", method="DELETE")
        assert busy.status == 409 and busy.body["error"] == "space_busy"
        assert live.request(f"/spaces/{made['id']}").status == 200
    # And while one is being erased, no turn enters it.
    assert daemon.begin_erase(made["id"])
    try:
        assert not daemon.space_open(made["id"])
        with daemon.in_space(made["id"]) as entered:
            assert not entered
    finally:
        daemon.end_erase(made["id"])
    assert live.request(f"/spaces/{made['id']}", method="DELETE").status == 200


def test_the_memory_page_and_make_core_validate_their_requests(live: Live) -> None:
    made = create(live)
    page = live.request(f"/spaces/{made['id']}/memory")
    assert page.status == 200 and page.body == {"rows": [], "showing": 0, "total": 0}
    core = live.request("/spaces/core/memory?kind=fact&limit=999")
    assert core.status == 200 and set(core.body) == {"rows", "showing", "total"}

    bad_kind = live.request(f"/spaces/{made['id']}/memory?kind=goal")
    assert bad_kind.status == 400 and bad_kind.body["error"] == "bad_request"
    bad_limit = live.request(f"/spaces/{made['id']}/memory?limit=lots")
    assert bad_limit.status == 400 and bad_limit.body["error"] == "bad_request"
    assert live.request("/spaces/spc_0123456789ab/memory").status == 404

    def make_core(space: str, mem: str) -> tuple[int, dict[str, Any]]:
        reply = live.request(f"/spaces/{space}/memory/{mem}/core", method="POST")
        return reply.status, reply.body

    status, body = make_core(made["id"], ids.mint("episode"))
    assert status == 400 and body["error"] == "bad_request"
    assert make_core(made["id"], "nothing")[0] == 400
    assert make_core("core", ids.mint("fact"))[0] == 400
    # No memory carries this project's stamp, so there is nothing to make core's.
    status, body = make_core(made["id"], ids.mint("fact"))
    assert (status, body["reason"]) == (404, "unknown_ref")
