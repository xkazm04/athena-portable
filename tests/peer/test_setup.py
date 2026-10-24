"""The setup leg: gated verbs, fixed argv, the five probe states, the setup session (ADR 0140, WP4).

athena/core/setup.py (the policy), athena/core/catalog.py ``register_setup``, athena/peer/setup.py
(the executors), and the daemon's ``setup_scope``. The OS is a fake: a runner that records every
argv it is handed, a knock that answers as told, a browser opener that records the URL. The gate,
the approvals table and ``POST /decisions/<id>`` are the real ones.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import pytest

from athena.contracts.registry import ToolClass, TurnContext
from athena.core.catalog import Catalog, CatalogError
from athena.core.setup import (
    OVERLAY_RANGES,
    SETUP_OPENING,
    SETUP_SESSION_ORIGIN,
    SETUP_TOOLS,
    SETUP_TOOLS_ORIGIN,
    SETUP_TURN_KEY,
    setup_name,
)
from athena.daemon.routes import turn_context
from athena.harness.cli_harness import CliHarness
from athena.harness.hooks import Cancel, Proceed
from athena.harness.transports import ScriptedTransport
from athena.peer import classify
from athena.peer.overlay import Overlay
from athena.peer.routes import hello
from athena.peer.setup import (
    FIREWALL_RULE,
    NOT_HERE,
    PEER_LIMIT,
    SETUP_LISTEN_S,
    WINGET_ARGV,
    Ran,
    SetupLive,
    SetupState,
    SetupTools,
    firewall_add_argv,
    firewall_show_argv,
)

from .conftest import Device, http

BINARY = "tailscale"
PEER_IP = "100.101.7.8"
CTX = TurnContext(conversation_id="conv_setup", turn_id="t1")


def status_doc(
    *,
    running: bool = True,
    peers: Sequence[tuple[str, str, bool]] = (),
    auth_url: str | None = None,
) -> str:
    return json.dumps(
        {
            "BackendState": "Running" if running else "NeedsLogin",
            "AuthURL": auth_url or "",
            "Self": {"TailscaleIPs": ["100.64.0.9", "fd7a:115c:a1e0::9"]},
            "CurrentTailnet": {"Name": "person@example.com"},
            "Peer": {
                f"key{i}": {
                    "HostName": name,
                    "TailscaleIPs": [ip],
                    "Online": online,
                    "OS": "windows",
                }
                for i, (name, ip, online) in enumerate(peers)
            },
        }
    )


@dataclass
class FakeRunner:
    """Records every argv. ``status`` is what ``tailscale status --json`` prints."""

    status: str = field(default_factory=status_doc)
    rule: bool = False
    ran: list[list[str]] = field(default_factory=list)
    spawned: list[list[str]] = field(default_factory=list)
    after_spawn: Callable[[FakeRunner], None] | None = None

    def run(self, argv: Sequence[str], timeout: float) -> Ran | None:
        argv = list(argv)
        self.ran.append(argv)
        if argv[1:] == ["status", "--json"]:
            return Ran(0, self.status)
        if argv == firewall_show_argv():
            return Ran(0, f"Rule Name: {FIREWALL_RULE}\n") if self.rule else Ran(1, "No rules\n")
        if argv[0] == "powershell":
            self.rule = True
            return Ran(0, "")
        return None

    def spawn(self, argv: Sequence[str]) -> bool:
        self.spawned.append(list(argv))
        if self.after_spawn is not None:
            self.after_spawn(self)
        return True


@dataclass
class Knock:
    answers: dict[str, bool] = field(default_factory=dict)
    knocked: list[tuple[str, int]] = field(default_factory=list)

    def __call__(self, ip: str, port: int) -> bool:
        self.knocked.append((ip, port))
        return self.answers.get(ip, False)


def tools_for(
    host: Any,
    runner: FakeRunner,
    *,
    platform: str = "win32",
    installed: bool = True,
    knock: Knock | None = None,
    opened: list[str] | None = None,
) -> SetupTools:
    return SetupTools(
        host,
        runner=runner,
        knock=knock or Knock(),
        opener=(opened if opened is not None else []).append,
        platform=platform,
        binary=lambda: BINARY if installed else None,
        sleep=lambda seconds: None,
    )


def answer(result: Any) -> dict[str, Any]:
    return json.loads(result.output)


# --- the policy ---------------------------------------------------------------------------------


def test_the_classes_are_the_cores_four_gated_three_read() -> None:
    classes = {tool.name: tool.cls for tool in SETUP_TOOLS}
    assert classes == {
        "overlay_status": ToolClass.READ,
        "list_overlay_peers": ToolClass.READ,
        "probe_peer": ToolClass.READ,
        "install_overlay": ToolClass.GATED,
        "overlay_login": ToolClass.GATED,
        "firewall_allow": ToolClass.GATED,
        "open_pairing": ToolClass.GATED,
    }
    catalog = Catalog()
    names = catalog.register_setup({})
    assert names == sorted(setup_name(tool.name) for tool in SETUP_TOOLS)
    assert all(catalog.get(name).origin == SETUP_TOOLS_ORIGIN for name in names)
    # An unattached name refuses honestly rather than vanishing.
    assert not catalog.get(setup_name("overlay_status")).executor({}, CTX).ok  # type: ignore[misc]


def test_a_vault_connector_cannot_take_the_setup_id() -> None:
    with pytest.raises(CatalogError, match="reserved"):
        Catalog().merge_connector("setup", object())  # type: ignore[arg-type]


def test_the_cores_overlay_ranges_are_the_classifiers() -> None:
    assert OVERLAY_RANGES == (classify.OVERLAY_V4, classify.OVERLAY_V6)


@pytest.mark.parametrize(
    ("ip", "ok"),
    [
        ("100.101.7.8", True),
        ("fd7a:115c:a1e0::5", True),
        ("::ffff:100.101.7.8", True),
        ("192.168.1.4", False),
        ("8.8.8.8", False),
        ("127.0.0.1", False),
        ("athena.example.com", False),
        ("100.101.7.8; calc.exe", False),
    ],
)
def test_probe_peer_takes_only_an_overlay_address_at_the_gate(ip: str, ok: bool) -> None:
    catalog = Catalog()
    catalog.register_setup({})
    verdict = catalog.validate(setup_name("probe_peer"), {"peer_ip": ip}, CTX)
    assert verdict.ok is ok


def test_open_pairing_takes_only_the_two_kinds() -> None:
    catalog = Catalog()
    catalog.register_setup({})
    name = setup_name("open_pairing")
    assert catalog.validate(name, {"kind": "phone"}, CTX).ok
    assert not catalog.validate(name, {"kind": "pc; rm"}, CTX).ok
    assert not catalog.validate(name, {"kind": "pc", "extra": 1}, CTX).ok


def test_setup_live_answers_for_setup_and_defers_the_rest() -> None:
    class Vault:
        def is_live(self, connector_id: str) -> bool:
            return connector_id == "gmail"

    live = SetupLive(Vault())
    assert live.is_live("setup") and live.is_live("gmail") and not live.is_live("notion")
    assert SetupLive(None).is_live("setup") and not SetupLive(None).is_live("gmail")


# --- fixed argv ----------------------------------------------------------------------------------


def test_install_runs_the_fixed_winget_argv_and_nothing_else(device: Device) -> None:
    runner = FakeRunner()
    result = tools_for(device.host, runner, installed=False).install_overlay({}, CTX)
    assert answer(result)["state"] == "started"
    assert runner.spawned == [
        [
            "winget",
            "install",
            "--id",
            "Tailscale.Tailscale",
            "-e",
            "--accept-source-agreements",
            "--accept-package-agreements",
        ]
    ]
    assert list(WINGET_ARGV) == runner.spawned[0]


def test_install_does_nothing_when_tailscale_is_already_there(device: Device) -> None:
    runner = FakeRunner()
    assert answer(tools_for(device.host, runner).install_overlay({}, CTX))["state"] == (
        "already_installed"
    )
    assert runner.spawned == []


def test_login_starts_tailscale_login_and_opens_only_its_own_sign_in_url(device: Device) -> None:
    url = "https://login.tailscale.com/a/abc123"
    runner = FakeRunner(status=status_doc(running=False))
    runner.after_spawn = lambda r: setattr(r, "status", status_doc(running=False, auth_url=url))
    opened: list[str] = []
    result = tools_for(device.host, runner, opened=opened).overlay_login({}, CTX)
    assert answer(result)["state"] == "opened"
    assert runner.spawned == [[BINARY, "login"]]
    assert opened == [url]


def test_login_will_not_open_a_url_that_is_not_tailscales(device: Device) -> None:
    runner = FakeRunner(status=status_doc(running=False, auth_url="https://evil.example/a/x"))
    opened: list[str] = []
    result = tools_for(device.host, runner, opened=opened).overlay_login({}, CTX)
    assert answer(result)["state"] == "started"
    assert opened == []


def test_firewall_checks_first_adds_once_with_the_fixed_rule_and_checks_again(
    device: Device,
) -> None:
    runner = FakeRunner()
    tools = tools_for(device.host, runner)
    first = answer(tools.firewall_allow({}, CTX))
    assert first["state"] == "allowed"
    port = device.host.port
    assert runner.ran == [firewall_show_argv(), firewall_add_argv(port), firewall_show_argv()]
    assert firewall_show_argv() == [
        "netsh",
        "advfirewall",
        "firewall",
        "show",
        "rule",
        "name=Athena peer",
    ]
    command = firewall_add_argv(port)
    assert command[:4] == ["powershell", "-NoProfile", "-NonInteractive", "-Command"]
    assert command[4] == (
        "Start-Process -FilePath netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "
        '\'advfirewall firewall add rule name="Athena peer" dir=in action=allow protocol=TCP '
        f"localport={port} remoteip=100.64.0.0/10'"
    )
    runner.ran.clear()
    assert answer(tools.firewall_allow({}, CTX))["state"] == "already_allowed"
    assert runner.ran == [firewall_show_argv()]


@pytest.mark.parametrize("verb", ["install_overlay", "overlay_login", "firewall_allow"])
def test_off_windows_the_machine_changing_verbs_run_nothing(device: Device, verb: str) -> None:
    runner = FakeRunner()
    result = getattr(tools_for(device.host, runner, platform="linux"), verb)({}, CTX)
    assert not result.ok
    assert answer(result)["detail"] == NOT_HERE
    assert runner.ran == [] and runner.spawned == []


# --- the reads ----------------------------------------------------------------------------------


def test_overlay_status_reads_the_four_fields(device: Device) -> None:
    status = answer(tools_for(device.host, FakeRunner()).overlay_status({}, CTX))
    assert status == {
        "installed": True,
        "logged_in": True,
        "ip": "100.64.0.9",
        "tailnet_name": "person@example.com",
    }
    absent = answer(tools_for(device.host, FakeRunner(), installed=False).overlay_status({}, CTX))
    assert absent == {"installed": False, "logged_in": False, "ip": None, "tailnet_name": None}


@pytest.mark.parametrize(
    ("installed", "running", "online", "answers", "state"),
    [
        (False, True, True, True, "no_overlay"),
        (True, False, True, True, "logged_out"),
        (True, True, False, True, "peer_unreachable"),
        (True, True, True, False, "athena_asleep"),
        (True, True, True, True, "ok"),
    ],
)
def test_probe_tells_the_five_states_apart(
    device: Device, installed: bool, running: bool, online: bool, answers: bool, state: str
) -> None:
    runner = FakeRunner(status=status_doc(running=running, peers=[("study", PEER_IP, online)]))
    knock = Knock({PEER_IP: answers})
    tools = tools_for(device.host, runner, installed=installed, knock=knock)
    assert answer(tools.probe_peer({"peer_ip": PEER_IP}, CTX))["state"] == state
    # Only an online peer is ever knocked on, and only on this host's peer port.
    assert all(port == device.host.port for _, port in knock.knocked)
    assert bool(knock.knocked) is (installed and running and online)


def test_a_peer_not_in_the_tailnet_is_unreachable_and_not_knocked(device: Device) -> None:
    knock = Knock({PEER_IP: True})
    tools = tools_for(device.host, FakeRunner(), knock=knock)
    assert answer(tools.probe_peer({"peer_ip": PEER_IP}, CTX))["state"] == "peer_unreachable"
    assert knock.knocked == []


def test_list_peers_knocks_online_ones_and_announces_what_it_cut(device: Device) -> None:
    peers = [(f"pc{i:02d}", f"100.101.0.{i + 1}", i % 2 == 0) for i in range(PEER_LIMIT + 3)]
    knock = Knock({"100.101.0.1": True})
    result = tools_for(device.host, FakeRunner(status=status_doc(peers=peers)), knock=knock)
    listed = result.list_overlay_peers({}, CTX)
    lines = listed.output.splitlines()
    assert lines[-1] == f"(showing {PEER_LIMIT} of {PEER_LIMIT + 3})"
    rows = [json.loads(line) for line in lines[:-1]]
    first = next(row for row in rows if row["ip"] == "100.101.0.1")
    assert first["athena"] is True and first["online"] is True
    assert all(row["athena"] is None for row in rows if not row["online"])


# --- through the real gate ----------------------------------------------------------------------


def setup_ctx(device: Device) -> TurnContext:
    assert device.ui("/devices/setup", method="POST", body={}).status == 200
    session = device.local.daemon.sessions.get(SETUP_SESSION_ORIGIN)
    assert session is not None
    return turn_context(device.local.daemon, session)


@pytest.mark.parametrize(
    ("verb", "params"),
    [
        ("install_overlay", {}),
        ("overlay_login", {}),
        ("firewall_allow", {}),
        ("open_pairing", {"kind": "pc"}),
    ],
)
def test_each_gated_verb_files_a_card_and_runs_only_after_yes(
    device: Device, verb: str, params: dict[str, Any]
) -> None:
    runner = FakeRunner(status=status_doc(running=verb != "overlay_login"))
    calls: list[str] = []
    tools = tools_for(device.host, runner, installed=verb != "install_overlay")
    executors = tools.executors()

    def counted(name: str) -> Any:
        def run(p: dict[str, Any], ctx: TurnContext) -> Any:
            calls.append(name)
            return executors[name](p, ctx)

        return run

    device.local.catalog.register_setup({name: counted(name) for name in executors})
    ctx = setup_ctx(device)
    entry = device.local.catalog.get(setup_name(verb))
    outcome = device.local.gate.before_tool_call(entry, params, ctx, rationale="setting up")

    assert isinstance(outcome.decision, Cancel)
    assert outcome.decision.reason == "pending_approval"
    assert outcome.card is not None and outcome.card.action == setup_name(verb)
    assert calls == [] and runner.spawned == []
    assert not [argv for argv in runner.ran if argv[0] in ("powershell", "winget")]

    approval = outcome.decision.approval_id
    answered = device.ui(f"/decisions/{approval}", method="POST", body={"choice": "approve"})
    assert answered.status == 200, answered.body
    assert calls == [verb]
    assert json.loads(answered.body["output"])["state"] in {
        "started",
        "opened",
        "allowed",
        "open",
    }


def test_a_declined_card_runs_nothing(device: Device) -> None:
    runner = FakeRunner()
    device.local.catalog.register_setup(tools_for(device.host, runner, installed=False).executors())
    ctx = setup_ctx(device)
    entry = device.local.catalog.get(setup_name("install_overlay"))
    outcome = device.local.gate.before_tool_call(entry, {}, ctx)
    assert isinstance(outcome.decision, Cancel)
    approval = outcome.decision.approval_id
    assert device.ui(f"/decisions/{approval}", method="POST", body={"choice": "decline"}).status
    assert runner.spawned == []


def test_a_read_proceeds_in_the_setup_session(device: Device) -> None:
    ctx = setup_ctx(device)
    entry = device.local.catalog.get(setup_name("overlay_status"))
    assert isinstance(device.local.gate.before_tool_call(entry, {}, ctx).decision, Proceed)


def test_outside_the_setup_session_the_names_are_switched_off(device: Device) -> None:
    daemon = device.local.daemon
    session = daemon.sessions.touch("https://ledger.example", "ledger")
    ctx = turn_context(daemon, session)
    assert SETUP_TOOLS_ORIGIN in ctx.disabled_origins
    assert SETUP_TURN_KEY not in ctx.extra
    entry = device.local.catalog.get(setup_name("overlay_status"))
    refused = device.local.gate.before_tool_call(entry, {}, ctx).decision
    assert isinstance(refused, Cancel) and refused.reason == "foreign_origin"
    block = device.local.catalog.render_capabilities(ctx.lane, ctx.disabled_origins)
    assert "connector.setup." not in block.text


def test_the_setup_session_sees_only_core_and_setup_and_carries_the_steps(device: Device) -> None:
    daemon = device.local.daemon
    daemon.sessions.touch("https://ledger.example", "ledger")
    ctx = setup_ctx(device)
    assert ctx.extra[SETUP_TURN_KEY] is True
    assert SETUP_TOOLS_ORIGIN not in ctx.disabled_origins
    block = device.local.catalog.render_capabilities(ctx.lane, ctx.disabled_origins)
    assert all(setup_name(tool.name) in block.text for tool in SETUP_TOOLS)
    assert {o for o in device.local.catalog.origins if o not in ctx.disabled_origins} == {
        "core",
        SETUP_TOOLS_ORIGIN,
    }

    from athena.core.prompt import compose

    composed = compose(
        constitution=device.local.constitution,
        catalog=device.local.catalog,
        disabled_origins=ctx.disabled_origins,
        setup=True,
    )
    assert composed.frame.block("frame.setup").text.startswith("## Setting up One Athena")
    plain = compose(constitution=device.local.constitution, catalog=device.local.catalog)
    assert all(block.name != "frame.setup" for block in plain.frame.blocks)


def test_a_page_cannot_register_the_setup_session(device: Device) -> None:
    refused = device.ui(
        "/manifest",
        method="POST",
        body={"app_id": "setup", "page_origin": SETUP_SESSION_ORIGIN, "tools": []},
    )
    assert refused.status == 400


# --- pairing and the phase ----------------------------------------------------------------------


def test_open_pairing_gives_a_pc_its_code_and_never_the_phone_url(device: Device) -> None:
    tools = tools_for(device.host, FakeRunner())
    seen: list[tuple[str, dict[str, Any]]] = []
    device.host.publish = lambda kind, /, **fields: seen.append((kind, fields))  # type: ignore[method-assign]

    pc = answer(tools.open_pairing({"kind": "pc"}, CTX))
    assert pc["state"] == "open" and len(pc["code"]) == 6

    phone = tools.open_pairing({"kind": "phone"}, CTX)
    assert "#claim=" not in phone.output and "code" not in answer(phone)
    record = device.host.pairings.get(seen[-1][1]["pairing_id"])
    assert record is not None and record.nonce not in phone.output
    # The QR URL went to this device's own window, on the loopback bus.
    assert seen[-1][0] == "pair.opened"
    assert seen[-1][1]["url"].endswith(f"/m/#claim={record.pairing_id}.{record.nonce}")


def test_setup_phase_is_null_until_a_setup_conversation_is_opened(device: Device) -> None:
    host = device.host
    from athena.daemon.routes import Request

    assert hello(host, Request("GET", "/peer/hello"))[1]["setup_phase"] is None
    assert device.ui("/devices/setup", method="POST", body={}).status == 200
    assert hello(host, Request("GET", "/peer/hello"))[1]["setup_phase"] == "ready"
    host.pairings.open_window("phone")
    assert hello(host, Request("GET", "/peer/hello"))[1]["setup_phase"] == "pairing"


def test_the_phase_follows_the_overlay_first(device: Device) -> None:
    state = SetupState(device.host)
    state.opened()
    device.host.probe = lambda: Overlay("absent")
    device.host.overlay(fresh=True)
    assert state.phase() == "installing"
    device.host.probe = lambda: Overlay("logged_out")
    device.host.overlay(fresh=True)
    assert state.phase() == "signing_in"


def test_the_setup_route_answers_with_the_session(device: Device) -> None:
    opened = device.ui("/devices/setup", method="POST", body={})
    assert opened.status == 200
    assert opened.body["origin"] == SETUP_SESSION_ORIGIN
    assert opened.body["conversation_id"] == "conv_setup"


def test_set_up_with_athena_keeps_the_listener_up_for_the_other_computers_probe(
    device: Device, clock: Any
) -> None:
    """Before pairing, nothing keeps the listener up, so the other computer's probe said
    "athena_asleep" about an Athena that was running. A setup conversation keeps it up for
    SETUP_LISTEN_S, and a stranger still gets 401."""
    device.host.reconcile()
    assert device.host.bound is None, "nothing paired, no window: down"
    assert device.ui("/devices/setup", method="POST", body={}).status == 200
    assert device.host.bound is not None, "up at once, not at the next tick"
    assert http(device.peer_port, "/peer/hello").status == 401
    clock.advance(SETUP_LISTEN_S - 1)
    device.host.reconcile()
    assert device.host.bound is not None
    clock.advance(2)
    device.host.reconcile()
    assert device.host.bound is None, "the setup window passed: down again"


def _round(text: str) -> list[str]:
    return [
        json.dumps({"type": "system", "session_id": "s-setup"}),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps({"type": "result", "is_error": False, "total_cost_usd": 0.01, "usage": {}}),
    ]


def test_set_up_with_athena_starts_the_conversation_with_the_daemons_own_words(
    device: Device,
) -> None:
    """The window sends ``start`` and no message; she is told SETUP_OPENING, and speaks first."""
    transport = ScriptedTransport([_round("Tailscale is not here yet. Shall I install it?")])
    harness = device.local.harness
    assert isinstance(harness, CliHarness)
    harness.transport = transport
    assert device.ui("/devices/setup", method="POST", body={}).status == 200
    ran = device.ui(
        "/run",
        method="POST",
        body={"origin": SETUP_SESSION_ORIGIN, "message": "", "start": True},
    )
    assert ran.status == 200
    assert b"turn.finished" in ran.raw and b"Shall I install it" in ran.raw
    (request,) = transport.requests
    assert SETUP_OPENING in request.stdin


@pytest.mark.parametrize(
    "body",
    [
        {"origin": SETUP_SESSION_ORIGIN, "message": "install it for me", "start": True},
        {"origin": "https://notes.example", "message": "", "start": True},
    ],
    ids=["words-of-its-own", "a-page-session"],
)
def test_only_the_setup_session_starts_on_its_own_and_with_no_words(
    device: Device, body: dict[str, Any]
) -> None:
    assert device.ui("/devices/setup", method="POST", body={}).status == 200
    registered = device.ui(
        "/manifest",
        method="POST",
        body={"app_id": "notes", "page_origin": "https://notes.example", "tools": []},
    )
    assert registered.status == 200
    refused = device.ui("/run", method="POST", body=body)
    assert refused.status == 400
    assert refused.body["reason"] == "validator_failed"


# --- the seams to the window (WP5) ---------------------------------------------------------------


def test_pair_opened_reaches_the_window_with_its_device_kind_through_the_real_bus(
    device: Device,
) -> None:
    # The bus stamps ``kind`` with the event's name; a field called ``kind`` would be overwritten,
    # and the Devices level could not tell a computer's code from a phone's address.
    tools = tools_for(device.host, FakeRunner())
    inbox = device.host.bus.subscribe()
    try:
        tools.open_pairing({"kind": "pc"}, CTX)
        tools.open_pairing({"kind": "phone"}, CTX)
        frames = [inbox.get(timeout=1), inbox.get(timeout=1)]
    finally:
        device.host.bus.unsubscribe(inbox)
    opened = [f for f in frames if f["kind"] == "pair.opened"]
    assert [f["device_kind"] for f in opened] == ["pc", "phone"]
    assert all(len(f["code"]) == 6 and f["expires_at"] for f in opened)


def test_the_overlay_route_lists_addresses_to_pick_without_knocking(device: Device) -> None:
    from athena.peer.setup import overlay_peers

    knock = Knock()
    peers = [(f"pc{i:02d}", f"100.101.7.{i + 1}", i % 2 == 0) for i in range(PEER_LIMIT + 3)]
    tools = tools_for(device.host, FakeRunner(status=status_doc(peers=peers)), knock=knock)
    status, body = overlay_peers(tools)
    assert status == 200 and body["state"] == "up" and body["self_ip"] == "100.64.0.9"
    assert body["showing"] == PEER_LIMIT and body["total"] == PEER_LIMIT + 3
    assert body["footer"] == f"(showing {PEER_LIMIT} of {PEER_LIMIT + 3})"
    # Online ones first, and nobody was dialled: picking an address is not probing it.
    assert body["peers"][0]["online"] is True and knock.knocked == []

    signed_out = tools_for(device.host, FakeRunner(status=status_doc(running=False, peers=peers)))
    assert overlay_peers(signed_out)[1]["state"] == "logged_out"
    assert overlay_peers(signed_out)[1]["peers"] == []
    absent = tools_for(device.host, FakeRunner(), installed=False)
    assert overlay_peers(absent)[1] | {"self_ip": None} == {
        "ok": True,
        "state": "no_overlay",
        "self_ip": None,
        "peers": [],
        "showing": 0,
        "total": 0,
        "footer": "",
    }


def test_the_overlay_route_is_served_on_the_loopback_daemon(device: Device) -> None:
    assert device.local.daemon.routes.match("GET", "/devices/overlay") is not None
