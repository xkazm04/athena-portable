"""Pre-trust refusals are answered after a fixed delay (ADR 0140; the device-pairing standard's
timing-defenses: "the fixed-delay refusal").

athena/peer/listener.py: a wrong code, nonce or claim secret, a second device on a taken window and
a request without a token each take at least ``REFUSAL_DELAY_S`` from arrival, so online guessing
is throttled with no lockout state and the speed of a refusal does not say which door it was.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from athena.peer import listener as listener_module

from .conftest import Device, Reply, http

DELAY = 0.25


def _timed(device: Device, path: str, **kwargs: Any) -> tuple[float, Reply]:
    began = time.monotonic()
    answer = device.peer(path, **kwargs)
    return time.monotonic() - began, answer


def _window(device: Device) -> tuple[str, str, str]:
    opened = device.ui("/devices/pairing", method="POST", body={"kind": "phone"})
    pairing_id, nonce = opened.body["url"].split("#claim=", 1)[1].split(".", 1)
    return pairing_id, nonce, opened.body["code"]


def test_every_kind_of_pre_trust_refusal_takes_the_floor_and_a_success_does_not(
    device: Device,
) -> None:
    assert listener_module.REFUSAL_DELAY_S == DELAY
    pairing_id, nonce, code = _window(device)
    asked = device.peer(
        "/peer/pair/request",
        method="POST",
        body={"pairing_id": pairing_id, "nonce": nonce, "name": "P", "kind": "phone"},
    )
    assert asked.status == 200
    refusals = {
        "unauthorized": _timed(device, "/peer/hello"),
        "wrong_code": _timed(
            device, "/peer/pair/request", method="POST", body={"code": "ZZZZZZ", "kind": "phone"}
        ),
        "wrong_nonce": _timed(
            device,
            "/peer/pair/claim",
            method="POST",
            body={"pairing_id": pairing_id, "nonce": "not-the-nonce"},
        ),
        "wrong_secret": _timed(
            device,
            "/peer/pair/claim",
            method="POST",
            body={"code": code, "claim_secret": "not-the-secret"},
        ),
        "window_taken": _timed(
            device, "/peer/pair/request", method="POST", body={"code": code, "kind": "phone"}
        ),
        "pairing_unknown": _timed(
            device,
            "/peer/pair/claim",
            method="POST",
            body={"pairing_id": "pair_000000000000", "nonce": "x"},
        ),
    }
    for word, (took, answer) in refusals.items():
        assert answer.body.get("error") == word, (word, answer.body)
        assert took >= DELAY * 0.95, f"{word} answered in {took:.3f}s"
    spread = max(t for t, _ in refusals.values()) - min(t for t, _ in refusals.values())
    assert spread < 0.1, f"refusal times differ by {spread:.3f}s across kinds"
    # A success is not slowed: the pending answer to a claim before anyone approves.
    took, answer = _timed(
        device, "/peer/pair/claim", method="POST", body={"pairing_id": pairing_id, "nonce": nonce}
    )
    assert answer.status == 202 and took < DELAY * 0.8, f"a 202 took {took:.3f}s"


def test_thirty_two_concurrent_refusals_hold_a_bounded_number_of_threads(device: Device) -> None:
    _window(device)
    baseline = threading.active_count()
    peak = [baseline]
    stop = threading.Event()

    def watch() -> None:
        while not stop.is_set():
            peak[0] = max(peak[0], threading.active_count())
            time.sleep(0.005)

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    port = device.peer_port
    began = time.monotonic()
    with ThreadPoolExecutor(max_workers=32) as pool:
        answers = list(pool.map(lambda _: http(port, "/peer/hello"), range(32)))
    elapsed = time.monotonic() - began
    stop.set()
    watcher.join(timeout=2)
    assert {answer.status for answer in answers} == {401}
    assert elapsed < DELAY * 6, (
        f"32 refusals took {elapsed:.2f}s: they queued instead of overlapping"
    )
    # 32 client workers + at most 32 handler threads + the sampler, over what was running before.
    assert peak[0] - baseline <= 32 + 32 + 2
