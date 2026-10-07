"""The Sandboxes REST adapter, against an in-memory service (README §9; ADR 0033)."""

from __future__ import annotations

import json
from collections.abc import Mapping

import pytest

from athena.proving.sandbox.client import (
    ERROR_CHARS,
    HttpReply,
    SandboxClient,
    SandboxError,
    bounded,
)

from .fakes import FakeClock, FakeSandboxes


def _image(client: SandboxClient) -> str:
    image = client.wait(client.import_image("docker://busybox")).result_image
    assert image is not None
    return image


def test_every_call_carries_the_bearer_and_the_project(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    client.whoami()
    headers = fake.headers_seen[-1]
    assert headers["Authorization"] == f"Bearer {client.api_key}"
    assert headers["Project"] == "aiproject-test"


def test_the_key_is_in_no_repr(client: SandboxClient, fake_key: str) -> None:
    assert fake_key not in repr(client)


def test_a_missing_project_is_the_services_own_sentence(
    fake: FakeSandboxes, clock: FakeClock, fake_key: str
) -> None:
    bare = SandboxClient(api_key=fake_key, project="", http=fake, clock=clock, sleep=clock.sleep)
    with pytest.raises(SandboxError) as caught:
        bare.whoami()
    assert caught.value.status == 400
    assert caught.value.detail == 'Missing "Project" header'


def test_a_refusal_is_verbatim_and_scrubbed_of_the_key(
    client: SandboxClient, fake: FakeSandboxes, fake_key: str
) -> None:
    fake.permissions = dict.fromkeys(fake.permissions, False)
    fake.echo_key_in_errors = fake_key
    with pytest.raises(SandboxError) as caught:
        client.spawn("true", "tag:busybox:latest", disposable=True)
    assert caught.value.status == 403
    assert caught.value.detail.startswith("Insufficient permissions: spawn or spawn_disposable")
    assert fake_key not in str(caught.value)
    assert "<key>" in caught.value.detail


def test_spawn_sends_one_shell_command_with_networking_files_and_env(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    client.spawn(
        "echo hi",
        "img-1",
        env={"A": "b"},
        files={"/tmp/x.tgz": "file-1"},
        networking=False,
        timeout=42,
    )
    sent = fake.requests[-1]
    assert sent["shell"] is True
    assert sent["disposable"] is False
    assert sent["networking"] == {"enabled": False}
    assert sent["files"] == {"/tmp/x.tgz": {"uuid": "file-1"}}
    assert sent["env"] == {"A": "b"}
    assert sent["timeout"] == 42


def test_run_polls_to_the_end_and_decodes_the_result(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.polls_before_done = 3
    image = _image(client)
    op = client.run("echo branch-0 > /state/marker", image)
    assert op.ok
    assert op.result_image not in (None, image)
    assert op.duration_s == 1.5
    assert op.wall_s > 0
    polls = [c for c in fake.calls if c[1].startswith("/operations/")]
    assert len(polls) >= 8  # two operations, four polls each


def test_an_operation_never_keeps_the_env_it_was_sent(client: SandboxClient, fake_key: str) -> None:
    op = client.run("true", _image(client), env={"NEBIUS_API_KEY": fake_key}, disposable=True)
    assert fake_key not in repr(op)
    assert "env" not in op.__dataclass_fields__


def test_wait_gives_up_and_says_so(client: SandboxClient, fake: FakeSandboxes) -> None:
    fake.polls_before_done = 10_000
    op_id = client.spawn("sleep 1", "img-x")
    op = client.wait(op_id, limit_s=5)
    assert op.timed_out and not op.ok
    assert "after 5s" in op.error


def test_a_failed_import_is_an_operation_not_an_exception(
    client: SandboxClient, fake: FakeSandboxes
) -> None:
    fake.import_fails = True
    op = client.wait(client.import_image("docker://nope"))
    assert op.status == "FAILED"
    assert op.error == "manifest unknown"
    assert op.result_image is None


def test_read_file_returns_bytes_and_a_missing_file_raises_404(client: SandboxClient) -> None:
    child = client.run("echo parent-0 > /state/marker", _image(client)).result_image
    assert child is not None
    assert client.read_file(child, "/state/marker") == b"parent-0"
    with pytest.raises(SandboxError) as caught:
        client.read_file(child, "/nope")
    assert caught.value.status == 404


def _replying(reply: HttpReply) -> object:
    def http(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> HttpReply:
        return reply

    return http


def test_a_non_json_error_body_is_kept_as_text(clock: FakeClock) -> None:
    http = _replying(HttpReply(502, b"<html>bad gateway</html>"))
    client = SandboxClient(api_key="k", project="p", http=http, clock=clock)  # type: ignore[arg-type]
    with pytest.raises(SandboxError) as caught:
        client.whoami()
    assert caught.value.status == 502
    assert "bad gateway" in caught.value.detail


def test_reply_json_must_be_an_object(clock: FakeClock) -> None:
    http = _replying(HttpReply(200, json.dumps([1, 2]).encode()))
    client = SandboxClient(api_key="k", project="p", http=http, clock=clock)  # type: ignore[arg-type]
    with pytest.raises(SandboxError, match="not a JSON object"):
        client.whoami()


def test_a_long_error_is_cut_and_the_cut_announced() -> None:
    text = "x" * (ERROR_CHARS + 50)
    cut = bounded(text, ERROR_CHARS)
    assert cut.endswith(f"(showing {ERROR_CHARS} of {ERROR_CHARS + 50})")
    assert bounded("short", ERROR_CHARS) == "short"
