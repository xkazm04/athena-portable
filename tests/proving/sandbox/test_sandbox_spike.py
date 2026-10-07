"""The five-probe spike: sequencing, error capture, timing aggregation (README §9; ADR 0033)."""

from __future__ import annotations

import io
import json
import os
import tarfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from athena.proving.sandbox.__main__ import pack
from athena.proving.sandbox.client import API_KEY_ENV, PROJECT_ENV, SandboxClient
from athena.proving.sandbox.spike import (
    FALLBACK_IMAGE,
    SpikeConfig,
    SpikeResult,
    load_env_file,
    render_markdown,
    run_spike,
    summarize,
    write_report,
)

from .fakes import FakeSandboxes

FIXED = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
PROBES = ["boot", "daemon", "network", "fork", "timing"]


def _config(**overrides: Any) -> SpikeConfig:
    base: dict[str, Any] = {
        "repeats": 5,
        "branches": 4,
        "tarball": b"tgz",
        "app": True,
        "parallel": False,
    }
    return SpikeConfig(**{**base, **overrides})


def _spike(client: SandboxClient, **overrides: Any) -> SpikeResult:
    return run_spike(client, _config(**overrides), now=lambda: FIXED)


def _answers(result: SpikeResult) -> dict[str, str]:
    return {p.name: p.answer for p in result.probes}


def test_a_healthy_service_passes_all_five(client: SandboxClient) -> None:
    result = _spike(client)

    assert _answers(result) == dict.fromkeys(PROBES, "yes")
    assert result.verdict.startswith("PASS")
    fork = result.probe("fork").evidence
    assert fork["markers"] == ["branch-0", "branch-1", "branch-2", "branch-3"]
    assert fork["parent_marker"] == "parent-0"
    assert len(set(fork["branch_images"])) == 4
    assert fork["checkpoint_image"] not in fork["branch_images"]


def test_probes_run_in_dependency_order(client: SandboxClient, fake: FakeSandboxes) -> None:
    _spike(client, repeats=1)
    posts = [path for method, path in fake.calls if method == "POST"]
    assert posts[:3] == ["/images/import", "/files", "/instances"]
    commands = [r["command"] for r in fake.requests]
    assert "VERSION python" in commands[0]  # boot: setup
    assert "VERSION app" in commands[1]  # boot: the Next app
    assert "HEALTH status" in commands[2]  # daemon
    assert "MODELS status" in commands[3]  # network
    assert "parent-0" in commands[4]  # checkpoint
    assert [f"branch-{i}" in c for i, c in enumerate(commands[5:9])] == [True] * 4


def test_each_branch_runs_a_different_command(client: SandboxClient, fake: FakeSandboxes) -> None:
    _spike(client, repeats=1)
    branches = [r["command"].split("\n", 1)[1] for r in fake.requests[5:9]]
    assert len(set(branches)) == 4


def test_the_key_reaches_only_the_network_run_and_never_the_report(
    client: SandboxClient, fake: FakeSandboxes, fake_key: str, tmp_path: Path
) -> None:
    result = _spike(client, repeats=1)
    carrying = [r for r in fake.requests if fake_key in json.dumps(r)]
    assert len(carrying) == 1 and "MODELS status" in carrying[0]["command"]
    assert carrying[0]["disposable"] is True
    run_dir = write_report(result, tmp_path)
    for path in run_dir.iterdir():
        assert fake_key not in path.read_text(encoding="utf-8")


def test_timings_aggregate_every_round(client: SandboxClient) -> None:
    result = _spike(client, repeats=5)
    assert result.timings["checkpoint_s"]["n"] == 5
    assert result.timings["branch_round_trip_s"]["n"] == 20
    assert result.timings["fork_accept_s"]["n"] == 20
    assert result.timings["branch_service_duration_s"]["p50"] == 1.5
    assert result.probe("timing").evidence["rounds"] == 5


def test_parallel_forks_give_the_same_answers(client: SandboxClient) -> None:
    result = _spike(client, repeats=2, parallel=True)
    assert result.probe("fork").answer == "yes"
    assert result.timings["branch_round_trip_s"]["n"] == 8


def test_no_permission_blocks_everything_and_quotes_the_refusal(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.permissions = dict.fromkeys(fake.permissions, False)
    result = _spike(client)

    assert set(_answers(result).values()) == {"blocked"}
    assert result.verdict.startswith("BLOCKED")
    assert result.preflight["spawn_refusal"] == (
        "spawn -> HTTP 403: Insufficient permissions: spawn or spawn_disposable"
    )
    assert result.preflight["permissions"]["spawn"] is False
    # One whoami and one refused spawn: a blocked key costs nothing else.
    assert [p for _, p in fake.calls] == ["/whoami", "/instances"]


def test_a_permission_map_that_lies_is_noted_and_the_spike_goes_on(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    # whoami says no spawn; the service accepts one anyway. Note it, then trust the service.
    fake.permissions = {**dict.fromkeys(fake.permissions, False), "import": True}
    fake.enforce_spawn = False
    result = _spike(client, repeats=1)
    assert "spawn_refusal" not in result.preflight
    assert "yet a spawn was accepted" in result.preflight["note"]
    assert result.probe("boot").answer == "yes"


def test_no_network_inside_limits_the_world_to_fork_isolated_tests(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.network = False
    result = _spike(client, repeats=1)
    assert result.probe("network").answer == "no"
    assert result.probe("network").evidence["models"] == {"status": "none", "error": "URLError"}
    assert result.probe("fork").answer == "yes"
    assert result.verdict.startswith("LIMITED: forks work without networking")


def test_a_failed_boot_blocks_what_needs_it_and_still_asks_the_network(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.import_fails = True
    result = _spike(client)
    answers = _answers(result)
    assert answers["boot"] == "no"
    assert answers["daemon"] == answers["fork"] == answers["timing"] == "blocked"
    assert answers["network"] == "no"  # the fallback import failed too
    assert any("manifest unknown" in e for e in result.probe("boot").errors)
    assert result.verdict.startswith("REJECTED")
    imports = [path for _, path in fake.calls if path == "/images/import"]
    assert len(imports) == 2  # the base, then the plain-Python fallback for the network probe


def test_the_network_probe_names_its_fallback_image(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    calls = 0
    original = fake._import

    def second_succeeds(request: dict[str, Any]) -> Any:
        nonlocal calls
        calls += 1
        fake.import_fails = calls == 1
        return original(request)

    fake._import = second_succeeds  # type: ignore[method-assign]
    result = _spike(client)
    assert result.probe("boot").answer == "no"
    assert result.probe("network").answer == "yes"
    assert result.probe("network").evidence["image"] == FALLBACK_IMAGE


def test_branches_that_do_not_diverge_fail_the_fork_question(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.marker_override = "same"
    result = _spike(client, repeats=1)
    assert result.probe("fork").answer == "no"
    assert result.probe("fork").evidence["markers"] == ["same"] * 4


def test_a_dead_daemon_is_a_no_with_the_evidence(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.daemon_ok = False
    result = _spike(client, repeats=1)
    assert result.probe("daemon").answer == "no"
    assert result.probe("daemon").evidence["health"] == {"status": "none"}


def test_summarize_omits_an_absent_measurement() -> None:
    assert summarize([]) == {}
    assert summarize([3.0, 1.0, 2.0, 10.0]) == {
        "n": 4.0,
        "p50": 2.5,
        "max": 10.0,
        "min": 1.0,
        "mean": 4.0,
    }


def test_the_report_is_json_and_markdown(client: SandboxClient, tmp_path: Path) -> None:
    result = _spike(client, repeats=2)
    run_dir = write_report(result, tmp_path)
    assert run_dir.name == "2026-10-07T120000Z"
    data = json.loads((run_dir / "sandbox-spike.json").read_text(encoding="utf-8"))
    assert data["verdict"] == result.verdict
    assert [p["name"] for p in data["probes"]] == PROBES
    md = render_markdown(result)
    assert result.verdict in md and "| checkpoint_s | 2 |" in md


def test_env_file_reads_only_the_names_asked_for(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text('NEBIUS_API_KEY="k1"\nOTHER=x\nNEBIUS_AI_PROJECT=aiproject-1\n', "utf-8")
    assert load_env_file(env, (API_KEY_ENV, PROJECT_ENV)) == {
        API_KEY_ENV: "k1",
        PROJECT_ENV: "aiproject-1",
    }


def test_the_tarball_leaves_build_output_and_caches_out(tmp_path: Path) -> None:
    (tmp_path / "src" / "athena" / "__pycache__").mkdir(parents=True)
    (tmp_path / "src" / "athena" / "x.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "src" / "athena" / "__pycache__" / "x.pyc").write_bytes(b"\0")
    (tmp_path / "app" / "node_modules").mkdir(parents=True)
    (tmp_path / "app" / "node_modules" / "big.js").write_text("", encoding="utf-8")
    (tmp_path / "app" / "page.tsx").write_text("", encoding="utf-8")
    blob = pack(tmp_path, ["src/athena", "app", "missing"])
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        names = set(archive.getnames())
    assert "src/athena/x.py" in names and "app/page.tsx" in names
    assert not any("node_modules" in n or "__pycache__" in n for n in names)


# --- live ----------------------------------------------------------------------------------------

_LIVE = bool(os.environ.get(API_KEY_ENV) and os.environ.get(PROJECT_ENV))


@pytest.mark.provider
@pytest.mark.skipif(not _LIVE, reason=f"{API_KEY_ENV} and {PROJECT_ENV} are not both set")
def test_live_the_spike_answers_every_question() -> None:
    """One round against the real service; a few VM-seconds once access is granted.

    Without Sandboxes access the honest answer is BLOCKED with the refusal quoted, so the test
    asserts every probe was answered and a block was explained — and, with access, that the
    fork question came back yes.
    """
    result = run_spike(SandboxClient(), SpikeConfig(repeats=1, app=False, tarball=None))
    assert all(p.answer in ("yes", "no", "blocked") for p in result.probes)
    if result.verdict.startswith("BLOCKED"):
        assert "spawn_refusal" in result.preflight or result.errors
    else:
        assert result.probe("fork").answer == "yes", result.probe("fork").errors
