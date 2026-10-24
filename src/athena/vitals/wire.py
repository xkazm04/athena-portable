"""This PC's vitals, assembled for the daemon: the service the wiring holds (ADR 0143).

:class:`VitalsService` puts the pieces together for one daemon - the :class:`Probe` on the brain's
volume, the :class:`Gate` over the task table and the ledger, the :class:`Sampler` thread - and is
the one object the rest of the build is handed:

- ``service.gate`` is the :class:`athena.vitals.RoomPort` the sleep cycle asks, and the task
  table's room (``tasks.room = service.gate``: a claim waits with the gate's reason);
- ``service.routes()`` is ``GET /vitals``;
- ``service.fleet()`` is the :class:`athena.vitals.FleetSource` Athena's ``frame.fleet`` block and
  ``core.devices`` read: this PC first, then every paired device with its presence and its vitals
  off its last hello (``None`` when stale, and always for a phone);
- ``service.start()`` / ``stop()`` run the sampler, from ``athena serve`` only.

Given the peer host, the service sets ``host.presence.own_vitals`` itself, so this PC's snapshot
rides its hello and its ``GET /devices`` with no other line of wiring.
"""

from __future__ import annotations

import socket
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from athena.daemon.routes import Reply, Request, Route
from athena.vitals import DeviceVitals, SleepSummary, VitalsView
from athena.vitals.gate import Gate
from athena.vitals.probe import Probe
from athena.vitals.sampler import Sampler

if TYPE_CHECKING:
    from athena.core.ledger import Ledger
    from athena.daemon.tasks import Tasks
    from athena.peer.listener import PeerHost

__all__ = ["VitalsService"]


class VitalsService:
    """The probe, the gate and the sampler of one daemon, and what it serves."""

    def __init__(
        self,
        *,
        brain_root: Path,
        ledger: Ledger,
        tasks: Tasks | None,
        host: PeerHost | None,
        extra_running: Callable[[], int] = lambda: 0,
        sleep_summary: Callable[[], SleepSummary | None] = lambda: None,
        publish: Callable[..., None] | None = None,
        probe: Probe | None = None,
    ) -> None:
        self.host = host
        self.probe = probe or Probe(brain_root)
        self.gate = Gate(
            tasks_running=tasks.running_count if tasks is not None else (lambda: 0),
            extra_running=extra_running,
            charge_mb=ledger.task_charge_mb,
            runs=ledger.runs_summary,
            sleep=sleep_summary,
            publish=publish,
        )
        self.sampler = Sampler(self.probe, self.gate)
        if host is not None:
            host.presence.own_vitals = self.gate.vitals

    # -- what the daemon serves ----------------------------------------------------------------

    def vitals(self) -> VitalsView:
        """The latest snapshot; a reading is taken now when the sampler has not taken one yet."""
        view = self.gate.vitals()
        if view is None:
            self.sampler.sample()
            view = self.gate.vitals()
        assert view is not None  # observe() has run: the gate has a reading
        return view

    def routes(self) -> list[Route]:
        """``GET /vitals`` -> ``{"vitals": VitalsView}``, this PC."""

        def get(request: Request) -> Reply:
            return 200, {"ok": True, "vitals": self.vitals()}

        return [Route("GET", "/vitals", get)]

    def fleet(self) -> list[DeviceVitals]:
        """This PC first, then each paired device (:class:`athena.vitals.FleetSource`).

        This PC is ``online`` with its own snapshot; it has no ``device_id`` until it has an
        identity (``""``: one is minted only by pairing, never by being asked). A peer carries its
        presence verdict and its vitals off the last hello - ``None`` when stale, and for a phone,
        which says no hello.
        """
        device_id, name = self._me()
        rows: list[DeviceVitals] = [
            {
                "device_id": device_id,
                "name": name,
                "kind": "pc",
                "self": True,
                "presence": "online",
                "vitals": self.gate.vitals(),
            }
        ]
        host = self.host
        if host is None:
            return rows
        for row in host.registry.rows():
            kind: Literal["pc", "phone"] = "phone" if row.kind == "phone" else "pc"
            seen = host.presence.view(row.peer_id)
            rows.append(
                {
                    "device_id": row.peer_id,
                    "name": row.name,
                    "kind": kind,
                    "self": False,
                    "presence": seen["presence"],
                    "vitals": None if kind == "phone" else seen["vitals"],
                }
            )
        return rows

    def _me(self) -> tuple[str, str]:
        host = self.host
        if host is not None and host.identity.path.exists():
            me = host.identity.identity
            return me.device_id, me.name
        try:
            name = socket.gethostname().strip()
        except OSError:
            name = ""
        return "", name or "This computer"

    # -- the lifecycle (``athena serve`` only) -------------------------------------------------

    def start(self) -> None:
        self.sampler.start()

    def stop(self) -> None:
        self.sampler.stop()
