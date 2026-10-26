"""Which module builds which sense, and the two functions each one exports.

A sense module ``athena.senses.<name>`` exports exactly::

    def build(ctx: SenseContext) -> SenseOutput: ...
    def prove(ctx: SenseContext, output: SenseOutput,
              key: Mapping[str, Any]) -> list[ProofResult]: ...

``key`` is the chore's ``senses/key.json`` (the sense answer key, beside the bench's ``truth.json``
and, like it, never shown to Athena). Modules import lazily so a chore pays only for its senses.

**Fixture files** (``senses/fixtures/<media_id>.json``), the format the fixture backend reads and
every chore spike writes - each key optional::

    {"segments":   [{"label": str, "score": float, "box": [x0, y0, x1, y1],
                     "frame": int, "track_id": str}],
     "transcript": {"language": "en",
                    "turns": [{"speaker": str, "start_s": float, "end_s": float, "text": str}]},
     "reads":      [{"attempt": int,
                     "fields": [{"name": str, "value": str, "confidence": float,
                                 "frame": int, "box": [x0, y0, x1, y1]}],
                     "unreadable": [str]}]}

The fixture segmenter returns the segments whose ``label`` contains the prompt (case-insensitive;
an empty prompt returns all). The fixture reader returns ``reads[attempt]`` (else ``reads[0]``)
restricted to the requested fields; a requested field it does not hold is ``unreadable``.

**``senses/media.json``**::

    {"media": [{"id", "kind", "sense", "path"?, "source"?, "params"?, "personal"?}],
     "backends"?: {"segmenter": "fixture", "transcriber": "fixture", "reader": "claude"}}
"""

from __future__ import annotations

import importlib
from types import ModuleType

from athena.senses.contract import SenseName

SENSE_MODULES: dict[SenseName, str] = {
    "paper": "athena.senses.paper",
    "call": "athena.senses.call",
    "object": "athena.senses.object",
    "walk": "athena.senses.walk",
    "circle": "athena.senses.circle",
}

KEY_FILE = "key.json"


def sense_module(name: SenseName) -> ModuleType:
    return importlib.import_module(SENSE_MODULES[name])
