"""Where a credential rests: the file born 0600 and swapped in whole, and every seal's failure
typed (connectors/seal.py; README §4; ADR 0021). FileSeal under a temp home only; the keystore is
a stand-in module, never the machine's."""

from __future__ import annotations

import os
import stat
import sys
import types
from pathlib import Path
from typing import Any

import pytest

from athena.connectors.seal import FileSeal, KeyringSeal, SealUnavailable
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import Vault, VaultError

from .conftest import FakeProvider

POSIX = os.name == "posix"


def test_a_sealed_file_is_created_exclusive_with_mode_0600_and_swapped_in(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened: list[tuple[str, int, int]] = []
    real_open = os.open

    def spy(path: Any, flags: int, mode: int = 0o777, *args: Any, **kwargs: Any) -> int:
        opened.append((str(path), flags, mode))
        return real_open(path, flags, mode, *args, **kwargs)

    seal = FileSeal(tmp_path / "sealed")
    monkeypatch.setattr("athena.connectors.seal.os.open", spy)
    seal.seal("gmail.token", "first")
    seal.seal("gmail.token", "second")
    assert seal.unseal("gmail.token") == "second"
    assert len(opened) == 2
    for path, flags, mode in opened:
        assert path.endswith(".tmp") and not path.endswith("gmail.token.sealed")
        assert flags & os.O_CREAT and flags & os.O_EXCL and flags & os.O_WRONLY
        assert mode == 0o600
    assert sorted(p.name for p in (tmp_path / "sealed").iterdir()) == ["gmail.token.sealed"]
    if POSIX:
        mode_on_disk = stat.S_IMODE((tmp_path / "sealed" / "gmail.token.sealed").stat().st_mode)
        assert mode_on_disk == 0o600


def test_a_failed_swap_keeps_the_old_value_and_leaves_no_temp_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seal = FileSeal(tmp_path / "sealed")
    seal.seal("notion.token", "kept")

    def boom(*_: object) -> None:
        raise OSError("disk went away")

    monkeypatch.setattr("athena.connectors.seal.os.replace", boom)
    with pytest.raises(SealUnavailable, match="could not be written"):
        seal.seal("notion.token", "lost")
    assert seal.unseal("notion.token") == "kept"
    assert [p.name for p in (tmp_path / "sealed").iterdir()] == ["notion.token.sealed"]


def test_a_file_that_cannot_be_created_is_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seal = FileSeal(tmp_path / "sealed")

    def refused(*_: object, **__: object) -> int:
        raise PermissionError("no")

    monkeypatch.setattr("athena.connectors.seal.os.open", refused)
    with pytest.raises(SealUnavailable, match="PermissionError"):
        seal.seal("notion.token", "x")


@pytest.mark.skipif(not POSIX, reason="file modes are POSIX")
def test_on_posix_a_file_born_readable_by_others_is_refused_not_swallowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seal = FileSeal(tmp_path / "sealed")
    real_fstat = os.fstat

    def loose(fd: int) -> Any:
        found = real_fstat(fd)
        return types.SimpleNamespace(st_mode=(found.st_mode & ~0o777) | 0o644)

    monkeypatch.setattr("athena.connectors.seal.os.fstat", loose)
    with pytest.raises(SealUnavailable, match="mode 644"):
        seal.seal("notion.token", "x")
    assert list((tmp_path / "sealed").iterdir()) == [], "nothing is left behind"


class _BrokenKeyring(types.ModuleType):
    """A keyring whose backend fails the way a locked keychain does: with its own error type."""

    class BackendError(Exception):
        pass

    def set_password(self, service: str, name: str, value: str) -> None:
        raise self.BackendError("the keychain is locked")

    def get_password(self, service: str, name: str) -> str | None:
        raise self.BackendError("the keychain is locked")

    def delete_password(self, service: str, name: str) -> None:
        raise self.BackendError("the keychain is locked")


@pytest.fixture
def broken_keyring(monkeypatch: pytest.MonkeyPatch) -> KeyringSeal:
    monkeypatch.setitem(sys.modules, "keyring", _BrokenKeyring("keyring"))
    return KeyringSeal()


def test_a_keystore_error_is_typed_on_set_and_get(broken_keyring: KeyringSeal) -> None:
    with pytest.raises(SealUnavailable, match="BackendError"):
        broken_keyring.seal("notion.token", "x")
    with pytest.raises(SealUnavailable, match="BackendError"):
        broken_keyring.unseal("notion.token")
    broken_keyring.destroy("notion.token")  # a destroy never raises


def test_the_vault_turns_a_seal_failure_into_its_own_vocabulary(
    tmp_path: Path, specs: dict[str, ConnectorSpec], broken_keyring: KeyringSeal
) -> None:
    vault = Vault(
        tmp_path / "connectors", specs=specs, transport=FakeProvider(), seal=broken_keyring
    )
    with pytest.raises(VaultError, match="could not be stored"):
        vault.connect_token("notion", "ntn_test_token_0123456789")
    with pytest.raises(VaultError, match="could not be read"):
        vault.probe("notion")
