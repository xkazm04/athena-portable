"""An MCP server's tool, called from a turn of the real daemon (README §4; ADR 0144).

``serve_scripted.py`` with ``--no-connectors`` and ``--mcp-config`` pointing at a file that names
the loopback fake of ``tests/connectors/mcp_fake.py``. The engine is a recorded transcript; the
config loader, the MCP client, the catalog, the policy and the gate are the production ones, and
the call crosses a real socket from the daemon's process to the fake in this one.
"""

from __future__ import annotations

import json
import re

import pytest

from connectors.mcp_fake import TOKEN, FakeMcp, structured

from .conftest import Spawn, claude_round, op

ENV = "ATHENA_E2E_MCP_TOKEN"
READ = "connector.fake.gt_read"


def test_an_auto_mcp_tool_runs_in_the_daemon_and_its_fenced_result_is_the_turns_tool_result(
    spawn: Spawn, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeMcp().start()
    try:
        fake.results["gt_read"] = lambda args: structured(
            {"op": args.get("op"), "projects": [{"id": "prj_1", "title": "Blue hour"}]}
        )
        monkeypatch.setenv(ENV, TOKEN)
        home = spawn.home()
        config = home / "mcp.json"
        config.write_text(
            json.dumps({"servers": [{"id": "fake", "url": fake.url, "token_env": ENV}]}),
            encoding="utf-8",
        )
        daemon = spawn.scripted(
            [
                claude_round("Looking.\n" + op(READ, "list the projects", op="projects")),
                claude_round("There is one project, Blue hour."),
            ],
            home=home,
            extra=["--mcp-config", str(config)],
        )
        daemon.register()

        listing = daemon.request("/connectors").body
        (server,) = listing["mcp_servers"]
        assert server["health"] == "healthy" and server["live"] is True
        assert TOKEN not in json.dumps(listing)

        reply = daemon.run("what projects are there?")
        results = [p for kind, p in reply.frames() if kind == "tool.result"]
        assert [r["name"] for r in results] == [READ]
        (result,) = results
        assert result["ok"] is True
        assert "Blue hour" in result["output"]
        fence = re.match(r"<<<fake:(\w+)\n", result["output"])
        assert fence, "an MCP result comes back inside the nonce-tagged fence"
        assert result["output"].rstrip().endswith(f"fake:{fence.group(1)}>>>")
        assert not [p for kind, p in reply.frames() if kind == "decision.requested"]

        (call,) = fake.calls()
        assert call.body["params"] == {"name": "gt_read", "arguments": {"op": "projects"}}
        assert call.headers["authorization"] == f"Bearer {TOKEN}"
        assert daemon.request("/connectors").body["mcp_servers"][0]["health"] == "healthy"
        ledger = json.dumps(daemon.request("/ledger").body)
        assert TOKEN not in ledger and TOKEN not in reply.text
    finally:
        fake.stop()
