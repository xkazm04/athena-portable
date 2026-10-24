"""``ATHENA_HOME/mcp.json``: what is admitted, and that every refusal names the field and never the
value (connectors/mcp/config.py; ADR 0123)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.mcp.config import (
    McpConfigError,
    McpServer,
    load_config,
    parse_config,
    url_admitted,
)

GOOD = {"id": "gravitone", "url": "http://localhost:3150/api/mcp", "token_env": "GT_TOKEN"}


def one(**changes: Any) -> dict[str, Any]:
    server = {**GOOD, **changes}
    return {"servers": [{k: v for k, v in server.items() if v is not None}]}


def test_the_contract_example_is_admitted_as_one_server() -> None:
    config = parse_config(one())
    assert config.servers == (McpServer("gravitone", "http://localhost:3150/api/mcp", "GT_TOKEN"),)
    assert config.servers[0].origin == "connector:gravitone"


@pytest.mark.parametrize("ident", ["Gravitone", "9lives", "", "a.b", "x" * 33, "gt:1", 7])
def test_a_bad_id_is_refused_naming_the_field(ident: Any) -> None:
    with pytest.raises(McpConfigError, match=r"servers\[0\]\.id must match"):
        parse_config(one(id=ident))


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/api/mcp",
        "http://localhost.evil.example/api/mcp",
        "http://10.0.0.5:3150/api/mcp",
        "http://127.0.0.2/api/mcp",
        "ftp://localhost/api/mcp",
        "https:///nohost",
        "http://user:pw@localhost/api/mcp",
        "http://localhost:notaport/api/mcp",
    ],
)
def test_http_off_loopback_and_other_bad_urls_are_refused_without_echoing_them(url: str) -> None:
    with pytest.raises(McpConfigError, match=r"servers\[0\]\.url must be https") as caught:
        parse_config(one(url=url))
    assert url not in str(caught.value)


@pytest.mark.parametrize(
    "url",
    [
        "https://studio.example/api/mcp",
        "http://localhost:3150/api/mcp",
        "http://127.0.0.1:3150/api/mcp",
        "http://[::1]:3150/api/mcp",
    ],
)
def test_https_anywhere_and_http_on_the_three_loopback_names_are_admitted(url: str) -> None:
    assert url_admitted(url)
    assert parse_config(one(url=url)).servers[0].url == url


def test_a_missing_token_env_is_refused_by_name() -> None:
    with pytest.raises(McpConfigError, match=r"servers\[0\]\.token_env is missing"):
        parse_config(one(token_env=None))


def test_a_token_env_that_is_not_a_variable_name_is_refused_without_echoing_it() -> None:
    pasted = "gt_live-abc.def"
    with pytest.raises(McpConfigError, match="token_env must name") as caught:
        parse_config(one(token_env=pasted))
    assert pasted not in str(caught.value)


def test_a_token_pasted_into_the_file_is_refused_and_never_echoed() -> None:
    secret = "gt_0123456789abcdef"
    with pytest.raises(McpConfigError, match="unknown field") as caught:
        parse_config({"servers": [{**GOOD, "token": secret}]})
    assert secret not in str(caught.value)


def test_a_duplicate_or_reserved_id_is_refused() -> None:
    with pytest.raises(McpConfigError, match="listed twice"):
        parse_config({"servers": [GOOD, GOOD]})
    with pytest.raises(McpConfigError, match="built-in connector"):
        parse_config(one(id="gmail"), reserved={"gmail", "notion"})


def test_an_absent_file_is_no_servers_unless_it_was_asked_for(tmp_path: Path) -> None:
    assert load_config(tmp_path / "mcp.json").servers == ()
    with pytest.raises(McpConfigError, match="no file"):
        load_config(tmp_path / "mcp.json", required=True)


def test_a_file_that_is_not_json_names_the_position_not_the_text(tmp_path: Path) -> None:
    path = tmp_path / "mcp.json"
    path.write_text('{"servers": [ gt_secret_value ]}', encoding="utf-8")
    with pytest.raises(McpConfigError, match="not JSON") as caught:
        load_config(path)
    assert "gt_secret_value" not in str(caught.value)


def test_a_good_file_loads_and_remembers_its_path(tmp_path: Path) -> None:
    path = tmp_path / "mcp.json"
    path.write_text(json.dumps(one()), encoding="utf-8")
    config = load_config(path)
    assert config.path == str(path) and config.servers[0].id == "gravitone"


def test_the_config_error_is_a_value_error_so_serve_fails_on_its_failure_line() -> None:
    assert issubclass(McpConfigError, ValueError)


def test_serve_with_a_named_config_that_is_wrong_fails_on_its_failure_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import io

    from athena.daemon.server import serve

    monkeypatch.setenv("ATHENA_HOME", str(tmp_path))
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(one(url="http://example.com/api/mcp")), encoding="utf-8")
    for path, said in ((tmp_path / "absent.json", "no file"), (bad, "url must be https")):
        out = io.StringIO()
        code = serve(
            ["--port", "0", "--token", "t", "--no-connectors", "--mcp-config", str(path)],
            stream=out,
        )
        line = json.loads(out.getvalue())
        assert code == 1 and line["ok"] is False and said in json.dumps(line)
