"""The Sandboxes spike: five questions, measured, in order (README §9; ADR 0033).

A branching world for the Proving Ground needs four things from Sandboxes, and a number:

1. **boot** — an image with Python, this repo's daemon, Node, headless Chromium (and, if asked,
   one example Next app) starts and answers a command.
2. **daemon** — ``athena serve`` on a throwaway brain answers ``GET /health`` inside it.
3. **network** — code inside reaches ``https://api.tokenfactory.nebius.com/v1/models``, with the
   key passed as an env var of that one run and never baked into an image.
4. **fork** — from a checkpoint with the daemon's brain ready, four branches each run a different
   command and diverge: four different markers read back, the parent's unchanged.
5. **timing** — checkpoint latency, fork latency, branch round-trip; ``repeats`` rounds.

**What a checkpoint is here.** Sandboxes saves a run's filesystem as a new immutable image; it
does not save processes. So a checkpoint is a filesystem with the brain initialised, and every
branch starts its own daemon. That is a finding, not a workaround: a "fork" costs one VM boot
plus a daemon start, and the timing probe measures exactly that.

**A probe never raises.** Each answers ``yes``, ``no`` or ``blocked`` (an earlier answer, or a
permission, made it unaskable) with evidence and the service's errors verbatim. The preflight
reads the key's permissions first, so a key without Sandboxes access costs one refused spawn and
says so, instead of five stack traces.
"""

from __future__ import annotations

import json
import shlex
import statistics
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.proving.sandbox.client import (
    API_KEY_ENV,
    Operation,
    SandboxClient,
    SandboxError,
)

__all__ = [
    "BASE_IMAGE",
    "FALLBACK_IMAGE",
    "MODELS_URL",
    "Probe",
    "SpikeConfig",
    "SpikeResult",
    "run_spike",
    "summarize",
    "verdict",
    "write_report",
]

#: Public, no registry of ours needed: Node and Chromium are in it, Python is installed on top.
#: The tag was read from ``mcr.microsoft.com/v2/playwright/tags/list`` on 2026-10-07.
BASE_IMAGE = "docker://mcr.microsoft.com/playwright:v1.63.0-noble"

#: The network probe's image when boot failed: anything with ``python3`` answers the question.
FALLBACK_IMAGE = "docker://docker.io/library/python:3.12-slim"

#: The one URL the network probe fetches. Token Factory's own catalog, with the same key.
MODELS_URL = "https://api.tokenfactory.nebius.com/v1/models"

#: Where the repository lands inside the image.
REPO_DIR = "/opt/athena"

#: The tarball's path inside the run that unpacks it.
TARBALL = "/tmp/athena.tgz"

#: The daemon inside listens here, behind this throwaway token.
PORT = 8765
TOKEN = "spike-token"  # a per-VM throwaway, not a credential

ANSWERS = ("yes", "no", "blocked")


@dataclass
class Probe:
    """One question's answer, its evidence and the errors met on the way."""

    name: str
    question: str
    answer: str = "blocked"
    evidence: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


@dataclass
class SpikeConfig:
    base_image: str = BASE_IMAGE
    repeats: int = 5
    branches: int = 4
    #: The repository as a gzipped tarball; ``None`` skips the upload (tests).
    tarball: bytes | None = None
    #: Also install and build one example Next app (needs the network).
    app: bool = True
    parallel: bool = True


@dataclass
class SpikeResult:
    started_at: str
    base_image: str
    preflight: dict[str, Any] = field(default_factory=dict)
    probes: list[Probe] = field(default_factory=list)
    timings: dict[str, dict[str, float]] = field(default_factory=dict)
    verdict: str = ""
    errors: list[str] = field(default_factory=list)

    def probe(self, name: str) -> Probe:
        return next(p for p in self.probes if p.name == name)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def summarize(samples: Sequence[float]) -> dict[str, float]:
    """``n``, ``p50``, ``max``, ``min``, ``mean`` in seconds. No samples is an empty dict.

    An absent measurement is omitted, never written as 0 (the report's rule).
    """
    if not samples:
        return {}
    ordered = sorted(samples)
    return {
        "n": float(len(ordered)),
        "p50": round(statistics.median(ordered), 3),
        "max": round(ordered[-1], 3),
        "min": round(ordered[0], 3),
        "mean": round(statistics.fmean(ordered), 3),
    }


def verdict(result: SpikeResult) -> str:
    """PASS when 1-4 are all yes; otherwise which fallback the answers allow (ADR 0033)."""
    answers = {p.name: p.answer for p in result.probes}
    core = ("boot", "daemon", "network", "fork")
    if all(answers.get(name) == "yes" for name in core):
        return "PASS: sandbox-as-world adopted"
    if all(answers.get(name) == "blocked" for name in core):
        return "BLOCKED: no Sandboxes access; worlds stay local processes"
    if answers.get("fork") == "yes" and answers.get("network") != "yes":
        return "LIMITED: forks work without networking; use only for fork-isolated brain tests"
    if answers.get("fork") == "yes" and answers.get("daemon") != "yes":
        return "LIMITED: forks work, the daemon does not; use only for brain/store tests"
    return "REJECTED: worlds stay local processes"


# --- the probes --------------------------------------------------------------------------------


def run_spike(
    client: SandboxClient,
    config: SpikeConfig,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> SpikeResult:
    """All five probes, in dependency order. Never raises for a service failure."""
    result = SpikeResult(
        started_at=now().isoformat(timespec="seconds"), base_image=config.base_image
    )
    result.probes = [
        Probe("boot", "Does a sandbox boot from an image with the daemon, Node and Chromium?"),
        Probe("daemon", "Does `athena serve` answer GET /health inside, on a throwaway brain?"),
        Probe("network", f"Can code inside reach {MODELS_URL} with the key as a run env var?"),
        Probe("fork", f"Do {config.branches} forks of one checkpoint diverge, parent unchanged?"),
        Probe("timing", "Checkpoint latency, fork p50/max, branch round-trip."),
    ]
    if not _preflight(client, result):
        _block_all(result, "the key holds no Sandboxes permission in this project (see preflight)")
        result.verdict = verdict(result)
        return result

    ready = _boot(client, config, result.probe("boot"))
    if ready is None:
        for name in ("daemon", "fork", "timing"):
            _block(result.probe(name), "boot did not produce an image")
    else:
        _daemon(client, ready, result.probe("daemon"))
    _network(client, ready, result.probe("network"))
    if ready is not None:
        _fork_rounds(client, config, ready, result)
    result.verdict = verdict(result)
    return result


def _preflight(client: SandboxClient, result: SpikeResult) -> bool:
    """Read the permissions; when spawning is not allowed, capture one refusal verbatim."""
    try:
        who = client.whoami()
    except (SandboxError, OSError) as exc:
        result.preflight = {"whoami": "failed"}
        result.errors.append(_said(exc))
        return False
    raw = who.get("permissions")
    perms: dict[str, Any] = raw if isinstance(raw, dict) else {}
    result.preflight = {
        "project_set": bool(client.project),
        "permissions": perms,
        "limits": who.get("limits", {}),
        "operations_stat": who.get("operations_stat", {}),
    }
    if perms.get("spawn") or perms.get("spawn_disposable"):
        return True
    try:
        client.spawn("true", "tag:busybox:latest", disposable=True)
    except (SandboxError, OSError) as exc:
        result.preflight["spawn_refusal"] = _said(exc)
        return False
    # The map said no and the service said yes: trust the service, and note the disagreement.
    result.preflight["note"] = "whoami reported no spawn permission, yet a spawn was accepted"
    return True


def _boot(client: SandboxClient, config: SpikeConfig, probe: Probe) -> str | None:
    """Import the base, install Python if missing, unpack the repo, optionally build the app."""
    try:
        begin = client.clock()
        op_id = client.import_image(config.base_image)
        imported = client.wait(op_id, started=begin, limit_s=1800)
        probe.evidence["import_s"] = round(imported.wall_s, 3)
        if imported.status != "SUCCESS" or imported.result_image is None:
            probe.answer = "no"
            probe.errors.append(f"import {imported.status}: {imported.error}")
            return None
        image = imported.result_image
        probe.evidence["base_image_uuid"] = image
        files: dict[str, str] = {}
        if config.tarball is not None:
            files[TARBALL] = client.upload(config.tarball)
            probe.evidence["tarball_bytes"] = len(config.tarball)
        setup = client.run(
            _setup_script(config.tarball is not None), image, files=files, timeout=1200
        )
        probe.evidence["setup_s"] = round(setup.wall_s, 3)
        probe.evidence["versions"] = _tagged(setup.stdout, "VERSION")
        if not setup.ok:
            probe.answer = "no"
            probe.errors.append(_op_error("setup", setup))
            return None
        ready = setup.result_image or image
        if config.app:
            app = client.run(_app_script(), ready, timeout=1800)
            probe.evidence["app_s"] = round(app.wall_s, 3)
            probe.evidence["app_built"] = app.ok
            if app.ok:
                ready = app.result_image or ready
            else:
                probe.errors.append(_op_error("app", app))
        probe.evidence["ready_image_uuid"] = ready
        versions = probe.evidence["versions"]
        probe.answer = "yes" if all(k in versions for k in ("python", "node", "chromium")) else "no"
        if probe.answer == "no":
            probe.errors.append(
                f"missing from the image: {sorted({'python', 'node', 'chromium'} - set(versions))}"
            )
        return ready
    except (SandboxError, OSError) as exc:
        probe.answer = "no"
        probe.errors.append(_said(exc))
        return None


def _daemon(client: SandboxClient, image: str, probe: Probe) -> None:
    try:
        op = client.run(_daemon_script("/tmp/brain", "health"), image, disposable=True, timeout=180)
    except (SandboxError, OSError) as exc:
        probe.answer = "no"
        probe.errors.append(_said(exc))
        return
    probe.evidence["round_trip_s"] = round(op.wall_s, 3)
    health = _tagged(op.stdout, "HEALTH")
    probe.evidence["health"] = health
    probe.answer = "yes" if op.ok and health.get("status") == "200" else "no"
    if probe.answer == "no":
        probe.errors.append(_op_error("daemon", op))


def _network(client: SandboxClient, ready: str | None, probe: Probe) -> None:
    """Asked even when boot failed: on a plain Python image, so the answer is about the network."""
    key = client.api_key or ""
    if not key:
        _block(probe, f"{API_KEY_ENV} is not set")
        return
    try:
        image = ready
        if image is None:
            begin = client.clock()
            imported = client.wait(client.import_image(FALLBACK_IMAGE), started=begin, limit_s=900)
            if imported.result_image is None:
                probe.answer = "no"
                probe.errors.append(_op_error("import fallback", imported))
                return
            image = imported.result_image
            probe.evidence["image"] = FALLBACK_IMAGE
        op = client.run(
            _network_script(), image, disposable=True, env={API_KEY_ENV: key}, timeout=120
        )
    except (SandboxError, OSError) as exc:
        probe.answer = "no"
        probe.errors.append(_said(exc))
        return
    models = _tagged(op.stdout, "MODELS")
    probe.evidence["models"] = models
    probe.evidence["round_trip_s"] = round(op.wall_s, 3)
    probe.answer = "yes" if models.get("status") == "200" else "no"
    if probe.answer == "no":
        probe.errors.append(_op_error("network", op))


def _fork_rounds(
    client: SandboxClient, config: SpikeConfig, ready: str, result: SpikeResult
) -> None:
    """``repeats`` rounds of checkpoint then fork; round one answers the fork question."""
    fork, timing = result.probe("fork"), result.probe("timing")
    checkpoints: list[float] = []
    branches: list[float] = []
    service: list[float] = []
    accepts: list[float] = []
    for round_no in range(max(1, config.repeats)):
        try:
            outcome = _one_round(client, config, ready, round_no)
        except (SandboxError, OSError) as exc:
            target = fork if round_no == 0 else timing
            target.errors.append(f"round {round_no}: {_said(exc)}")
            if round_no == 0:
                fork.answer = "no"
                _block(timing, "the first checkpoint/fork round failed")
                return
            continue
        checkpoints.append(outcome["checkpoint_s"])
        branches.extend(outcome["branch_s"])
        service.extend(outcome["service_s"])
        accepts.extend(outcome["accept_s"])
        if round_no == 0:
            fork.evidence = {k: v for k, v in outcome.items() if not k.endswith("_s")}
            fork.answer = "yes" if outcome["diverged"] else "no"
            fork.errors.extend(outcome["errors"])
        elif outcome["errors"]:
            timing.errors.extend(f"round {round_no}: {e}" for e in outcome["errors"])
    result.timings = {
        name: stats
        for name, stats in {
            "checkpoint_s": summarize(checkpoints),
            "fork_accept_s": summarize(accepts),
            "branch_round_trip_s": summarize(branches),
            "branch_service_duration_s": summarize(service),
        }.items()
        if stats
    }
    timing.evidence = {"rounds": len(checkpoints), **result.timings}
    timing.answer = "yes" if len(checkpoints) >= min(5, config.repeats) else "no"


def _one_round(
    client: SandboxClient, config: SpikeConfig, ready: str, round_no: int
) -> dict[str, Any]:
    errors: list[str] = []
    checkpoint = client.run(_checkpoint_script(round_no), ready, timeout=300)
    if not checkpoint.ok or checkpoint.result_image is None:
        raise SandboxError("checkpoint", 0, _op_error("checkpoint", checkpoint))
    parent = checkpoint.result_image

    def branch(index: int) -> tuple[float, Operation]:
        begin = client.clock()
        op_id = client.spawn(_branch_script(index), parent, timeout=300)
        accepted = client.clock() - begin
        return accepted, client.wait(op_id, started=begin)

    indices = range(config.branches)
    if config.parallel:
        with ThreadPoolExecutor(max_workers=config.branches) as pool:
            runs = list(pool.map(branch, indices))
    else:
        runs = [branch(i) for i in indices]

    markers: list[str] = []
    for index, (_, op) in enumerate(runs):
        if not op.ok or op.result_image is None:
            errors.append(_op_error(f"branch {index}", op))
            markers.append("")
            continue
        markers.append(client.read_file(op.result_image, "/state/marker").decode().strip())
    parent_marker = client.read_file(parent, "/state/marker").decode().strip()
    expected = [f"branch-{i}" for i in indices]
    images = [op.result_image for _, op in runs]
    diverged = (
        markers == expected
        and parent_marker == f"parent-{round_no}"
        and len({i for i in images if i}) == config.branches
        and parent not in images
    )
    return {
        "checkpoint_image": parent,
        "branch_images": images,
        "markers": markers,
        "parent_marker": parent_marker,
        "branch_outputs": [_tagged(op.stdout, "BRANCH") for _, op in runs],
        "diverged": diverged,
        "errors": errors,
        "checkpoint_s": checkpoint.wall_s,
        "accept_s": [a for a, _ in runs],
        "branch_s": [op.wall_s for _, op in runs if op.ok],
        "service_s": [op.duration_s for _, op in runs if op.ok and op.duration_s is not None],
    }


# --- the scripts that run inside ---------------------------------------------------------------

#: The Python that ``athena serve`` runs on; the daemon is stdlib-only, so a source tree plus
#: ``PYTHONPATH`` is a complete install (no uv, no network, README §2 invariant 5).
_PY = f"PYTHONPATH={REPO_DIR}/src python3"


_HEALTH_POLL = """import sys, time, urllib.request
url = "http://127.0.0.1:@PORT@/health"
req = urllib.request.Request(url, headers={"X-Athena-Token": "@TOKEN@"})
last = "none"
for _ in range(60):
    try:
        r = urllib.request.urlopen(req, timeout=2)
        body = r.read()[:200].decode().replace(" ", "")
        print("@TAG@ status=%d body=%s" % (r.status, body))
        sys.exit(0)
    except Exception as e:
        last = type(e).__name__
        time.sleep(0.5)
print("@TAG@ status=none error=" + last)
"""

_MODELS_FETCH = """import json, os, urllib.error, urllib.request
key = os.environ["@KEY_ENV@"]
req = urllib.request.Request("@URL@", headers={"Authorization": "Bearer " + key})
try:
    r = urllib.request.urlopen(req, timeout=20)
    print("MODELS status=%d count=%d" % (r.status, len(json.load(r).get("data", []))))
except urllib.error.HTTPError as e:
    print("MODELS status=%d" % e.code)
except Exception as e:
    print("MODELS status=none error=%s" % type(e).__name__)
"""

_CHROMIUM = "ls -d /ms-playwright/chromium* $HOME/.cache/ms-playwright/chromium* 2>/dev/null"


def _fill(template: str, **values: str) -> str:
    for name, value in values.items():
        template = template.replace(f"@{name}@", value)
    return template


def _setup_script(unpack: bool) -> str:
    lines = [
        "set -e",
        "command -v python3 >/dev/null 2>&1 || (apt-get update -qq && "
        "apt-get install -y -qq --no-install-recommends python3 >/dev/null)",
    ]
    if unpack:
        lines.append(f"mkdir -p {REPO_DIR} && tar -xzf {TARBALL} -C {REPO_DIR} && rm -f {TARBALL}")
    lines += [
        "echo \"VERSION python=$(python3 -c 'import sys;print(sys.version.split()[0])')\"",
        'echo "VERSION node=$(node --version 2>/dev/null || echo missing)"',
        f"c=$({_CHROMIUM} | head -1)",
        'echo "VERSION chromium=${c:-missing}"',
    ]
    if unpack:
        version = "import athena;print(athena.__version__)"
        lines.append(f"echo \"VERSION athena=$({_PY} -c '{version}')\"")
    return "\n".join(lines)


def _app_script() -> str:
    install = "pnpm install --filter 'ledgerbox...' --no-frozen-lockfile"
    build = "pnpm --filter ledgerbox build"
    return "\n".join(
        [
            "set -e",
            f"cd {REPO_DIR}",
            "corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null",
            f"{install} >/tmp/app.log 2>&1 || (tail -20 /tmp/app.log; exit 1)",
            f"{build} >/tmp/app.log 2>&1 || (tail -20 /tmp/app.log; exit 1)",
            'echo "VERSION app=ledgerbox"',
        ]
    )


def _daemon_script(brain: str, tag: str) -> str:
    """Start the daemon, poll ``/health`` for up to 30 s, print one tagged line, stop it."""
    poll = _fill(_HEALTH_POLL, PORT=str(PORT), TOKEN=TOKEN, TAG=tag.upper())
    serve = (
        f"{_PY} -m athena.cli serve --port {PORT} --token {TOKEN} --brain {brain} "
        "--engine nebius --no-connectors --voice-backend none"
    )
    return "\n".join(
        [
            f"mkdir -p {brain}",
            f"{serve} >/tmp/daemon.log 2>&1 &",
            "pid=$!",
            f"python3 -c {shlex.quote(poll)}",
            "kill $pid 2>/dev/null; wait $pid 2>/dev/null || true",
            "tail -3 /tmp/daemon.log | sed 's/^/LOG /'",
        ]
    )


def _network_script() -> str:
    """GET the catalog with the key from this run's env; print the status and a count only."""
    fetch = _fill(_MODELS_FETCH, KEY_ENV=API_KEY_ENV, URL=MODELS_URL)
    return f"python3 -c {shlex.quote(fetch)} || echo 'MODELS status=none error=nopython'"


def _checkpoint_script(round_no: int) -> str:
    """The parent: a marker plus a brain the daemon has initialised (started once, stopped)."""
    return "\n".join(
        [
            "set -e",
            "mkdir -p /state",
            f"echo parent-{round_no} > /state/marker",
            _daemon_script("/state/brain", "checkpoint"),
        ]
    )


def _branch_script(index: int) -> str:
    """Each branch writes its own marker and runs a different command against the brain."""
    commands = [
        _daemon_script("/state/brain", "branch"),
        "echo BRANCH files=$(ls /state/brain | wc -l)",
        "echo BRANCH bytes=$(du -sk /state/brain | cut -f1)",
        "echo BRANCH uname=$(uname -r | tr ' ' '_')",
    ]
    return "\n".join([f"echo branch-{index} > /state/marker", commands[index % len(commands)]])


# --- helpers -----------------------------------------------------------------------------------


def _tagged(stdout: str, tag: str) -> dict[str, str]:
    """``TAG k=v k=v`` lines from a run's stdout, merged into one dict."""
    found: dict[str, str] = {}
    for line in stdout.splitlines():
        if line.startswith(tag + " "):
            for pair in line[len(tag) + 1 :].split():
                key, sep, value = pair.partition("=")
                if sep:
                    found[key] = value
    return found


def _op_error(what: str, op: Operation) -> str:
    tail = op.stderr.strip().splitlines()[-3:] or op.stdout.strip().splitlines()[-3:]
    return (
        f"{what}: status={op.status} exit={op.exit_code} timed_out={op.timed_out}"
        + (f" error={op.error}" if op.error else "")
        + (f" tail={' | '.join(tail)}" if tail else "")
    )


def _said(exc: BaseException) -> str:
    if isinstance(exc, SandboxError):
        return f"{exc.call} -> HTTP {exc.status}: {exc.detail}"
    return f"{type(exc).__name__}: {exc}"


def _block(probe: Probe, why: str) -> None:
    probe.answer = "blocked"
    probe.errors.append(f"blocked: {why}")


def _block_all(result: SpikeResult, why: str) -> None:
    for probe in result.probes:
        _block(probe, why)


# --- the report --------------------------------------------------------------------------------


def write_report(result: SpikeResult, root: Path, *, stamp: str | None = None) -> Path:
    """``<root>/<ts>/sandbox-spike.json`` and ``.md``; returns the run directory."""
    stamp = stamp or result.started_at.replace(":", "").replace("+0000", "Z")
    run_dir = root / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "sandbox-spike.json").write_text(
        json.dumps(result.to_json(), indent=2, sort_keys=True), encoding="utf-8"
    )
    (run_dir / "sandbox-spike.md").write_text(render_markdown(result), encoding="utf-8")
    return run_dir


def render_markdown(result: SpikeResult) -> str:
    lines = [
        "# Sandboxes spike",
        "",
        f"- started: {result.started_at}",
        f"- base image: `{result.base_image}`",
        f"- verdict: **{result.verdict}**",
        "",
        "## Preflight",
        "",
        "```json",
        json.dumps(result.preflight, indent=2, sort_keys=True),
        "```",
        "",
        "## Answers",
        "",
        "| # | probe | answer | question |",
        "|---|---|---|---|",
    ]
    for number, probe in enumerate(result.probes, 1):
        lines.append(f"| {number} | {probe.name} | {probe.answer} | {probe.question} |")
    if result.timings:
        lines += ["", "## Timings (seconds)", "", "| measure | n | p50 | max | min | mean |"]
        lines.append("|---|---|---|---|---|---|")
        for name, stats in result.timings.items():
            lines.append(
                f"| {name} | {int(stats['n'])} | {stats['p50']} | {stats['max']} | "
                f"{stats['min']} | {stats['mean']} |"
            )
    for probe in result.probes:
        if probe.evidence or probe.errors:
            lines += ["", f"## {probe.name}", ""]
            if probe.evidence:
                lines += ["```json", json.dumps(probe.evidence, indent=2, sort_keys=True), "```"]
            lines += [f"- error: `{e}`" for e in probe.errors]
    if result.errors:
        lines += ["", "## Errors", ""] + [f"- `{e}`" for e in result.errors]
    return "\n".join(lines) + "\n"


def load_env_file(path: Path, names: Sequence[str]) -> Mapping[str, str]:
    """``NAME=value`` lines for the names asked for; nothing is printed, nothing else is read."""
    found: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = raw.strip().partition("=")
        if sep and name.strip() in names:
            found[name.strip()] = value.strip().strip('"').strip("'")
    return found
