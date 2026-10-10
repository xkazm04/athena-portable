"""A benched playbook's evidence: its run, narrated and filmed (ADR 0055; README §14; ADR 0040).

``bench.json`` is the measured run as numbers. The evidence is the same run as something a person
watches: a narration that says what the chore is, what Athena found and walked past, and the
verdict; spoken by the local voice; laid over a recording of the desktop's own Playbooks layer
replaying that run. Five steps per playbook, each a tool the machine already has:

1. **Narration** — :func:`narration`, a pure function of ``playbook.json`` and ``bench.json``.
   No model writes it, so the same run always says the same words, and 45 to 90 s of them.
2. **Speech** — Kokoro (``af_heart``) through :class:`~athena.channels.voice.kokoro.KokoroTTS`
   and :func:`~athena.channels.voice.home.resolve_homes`, so no machine path is written down.
   Piper only when Kokoro is absent. Nothing goes over a network.
3. **Capture** — ``examples/journey/scripts/capture-playbook.mjs``: Playwright records
   ``preview.html?module=playbooks&fixture=shipped:<id>`` on its own Vite dev server, walking the
   abstract, every turn of *Watch the run*, then *What she filed*, paced to the narration.
4. **Mux** — ffmpeg (``$FFMPEG`` else PATH) writes H.264 + AAC, and a JPEG thumbnail of the
   result view, shrunk until it is under :data:`THUMB_MAX_BYTES`.
5. **Index** — ``playbooks/<id>/evidence.json`` (schema 1), repo-relative paths only.

The media lives under ``evidence/`` at the repository root, which is gitignored: the index and the
thumbnail are committed, the film is not. :func:`verify` says whether each index is still current
against its ``bench.json`` (``bench_run_at`` equal to ``run_at``) and re-hashes whatever media is
present on this machine. Every ``sha256`` in the index is of a file's bytes: ``narration.sha256`` is
the spoken WAV, since the text it was spoken from is already in the index word for word.

A rescore keeps ``run_at`` (``bench.write_bench``), and an edit to ``playbook.json`` changes no date
at all, so either can leave an index "current" whose narration no longer says what the record says.
:func:`verify` therefore also fills the narration again and compares it with the committed text; a
difference is reported, and the playbook wants filming again.

A ``bench.json`` or ``evidence.json`` that is not valid JSON, or not an object, makes that playbook
``unreadable``: a non-current standing whose notes name the file and the problem. The other
playbooks are still reported.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import wave
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.channels.voice.backends import VoiceBackendError
from athena.channels.voice.home import EXE_SUFFIX, EngineHomes, creation_flags, resolve_homes
from athena.channels.voice.kokoro import MAX_CHARS, KokoroTTS, find_voice, split_sentences
from athena.channels.voice.kokoro import SAMPLE_RATE as KOKORO_RATE
from athena.channels.voice.kokoro import probe as probe_kokoro
from athena.proving.playbooks.spec import PLAYBOOKS_DIRNAME, Playbook

__all__ = [
    "CAPTURE_SCRIPT",
    "EVIDENCE_DIRNAME",
    "MAX_SECONDS",
    "MIN_SECONDS",
    "SCHEMA",
    "THUMB_MAX_BYTES",
    "EvidenceError",
    "Tools",
    "Voice",
    "build_evidence",
    "choose_voice",
    "estimate_seconds",
    "find_tools",
    "fixture_for",
    "media_paths",
    "narration",
    "plan",
    "verify",
]

SCHEMA = 1
EVIDENCE_DIRNAME = "evidence"
#: Repo-relative: the recorder the capture step runs with Node.
CAPTURE_SCRIPT = "examples/journey/scripts/capture-playbook.mjs"
#: "Under 100 KB", read strictly: 100,000 bytes, not 102,400.
THUMB_MAX_BYTES = 100_000
#: How long the spoken narration may be.
MIN_SECONDS = 45.0
MAX_SECONDS = 90.0
#: Kokoro's ``af_heart`` on a narration thick with figures: measured at about 2.4 words a second.
WORDS_PER_SECOND = 2.4
#: What :func:`narration` aims for, inside the bounds with room for the estimate to be wrong.
TARGET_SECONDS = (55.0, 78.0)
#: The silence around the narration: a breath before the first word, a beat after the last.
LEAD_S = 0.5
TAIL_S = 1.0
#: A chore whose first sentence is longer than this is left out: it would be read, not heard.
CHORE_WORDS = 30
KOKORO_VOICE = "af_heart"
#: The Piper voice Personas installs beside Kokoro: ``companion-tts/piper/<voice>/<voice>.onnx``.
PIPER_VOICE = "en_US-amy-medium"
#: Widths (never wider than the still) and JPEG qualities (ffmpeg's ``-q:v``, lower is better),
#: tried in order for the thumbnail until one is under :data:`THUMB_MAX_BYTES`.
THUMB_STEPS: tuple[tuple[int, int], ...] = (
    (960, 3),
    (960, 5),
    (960, 8),
    (720, 8),
    (560, 10),
    (480, 14),
    (360, 20),
)


class EvidenceError(RuntimeError):
    """A step that could not run, with the tool or file it needed named."""


# --- 1. narration ------------------------------------------------------------------------------


def _first_sentence(text: str) -> str:
    """Up to the first stop that ends a sentence: not the one in "C.H." or "Dr."."""
    m = re.match(r"^(.+?[a-z0-9)][.!?])(\s|$)", text.strip())
    return m.group(1) if m else text.strip()


def _lower_first(text: str) -> str:
    """ "A store shipping…" read mid-sentence; an acronym ("SaaS", "EU") stays as it is."""
    return text[0].lower() + text[1:] if re.match(r"^(A|An)\b|^[A-Z][a-z]", text) else text


_MONEY = re.compile(r"(\b[Aa]n? )?\$(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)([kKmM]\b)?")


def _spoken(text: str) -> str:
    """Figures from a playbook's prose as they are said: "$6M" is "6 million dollars", "a $4M
    brand" is "a 4-million-dollar brand", "8%" is "8 percent"."""

    def money(m: re.Match[str]) -> str:
        article, amount, scale = m.group(1) or "", m.group(2), (m.group(3) or "").lower()
        if not scale:
            return f"{article}{amount} dollar{'' if amount == '1' else 's'}"
        word = "thousand" if scale == "k" else "million"
        return f"{article}{amount}-{word}-dollar" if article else f"{amount} {word} dollars"

    return re.sub(r"(\d)%", r"\1 percent", _MONEY.sub(money, text))


def _dollars(value: float) -> str:
    """Money as it is spoken: "416,700 dollars", "359 dollars and 78 cents"."""
    cents = round(value * 100)
    whole, part = divmod(cents, 100)
    if part == 0:
        return f"{whole:,} dollar{'' if whole == 1 else 's'}"
    return f"{whole:,} dollars and {part} cent{'' if part == 1 else 's'}"


def _duration(minutes: float) -> str:
    """Minutes as a person says them: "under a minute", "4 minutes", "about 25 hours"."""
    if minutes < 1:
        return "under a minute"
    if minutes < 90:
        n = round(minutes)
        return f"{n} minute{'' if n == 1 else 's'}"
    hours = minutes / 60
    n = round(hours)
    return f"about {n} hours" if abs(hours - n) > 0.05 else f"{n} hours"


def _count(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _and(items: Sequence[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else text + "."


def estimate_seconds(text: str) -> float:
    """How long ``text`` takes to say, from its words; the real figure comes from the WAV."""
    return len(text.split()) / WORDS_PER_SECOND


def narration(showcase: Mapping[str, Any], bench: Mapping[str, Any]) -> str:
    """What the film says, from ``playbook.json`` and ``bench.json`` alone. Pure.

    The parts every narration has — who it is for, what she found, the traps, her time against the
    manual time, the verdict — always stay. The parts that colour it — the chore's first sentence,
    the portals, two of the traps in words, the exact amounts, the caveat — are added in that order
    while the estimate stays under the target, so a playbook with long prose is not read for two
    minutes and one with short prose still fills its 45 seconds.
    """
    title = str(showcase.get("title") or showcase.get("id") or "This playbook")
    persona = str(showcase.get("persona", "")).strip()
    economics = showcase.get("economics", {})
    econ = economics if isinstance(economics, Mapping) else {}
    score_raw = bench.get("score", {})
    score = score_raw if isinstance(score_raw, Mapping) else {}
    verdict_raw = bench.get("verdict", {})
    verdict = verdict_raw if isinstance(verdict_raw, Mapping) else {}

    found = int(score.get("found", 0) or 0)
    eligible = int(score.get("eligible", 0) or 0)
    exact = int(score.get("exact", 0) or 0)
    value_found = float(score.get("value_found_usd", 0) or 0)
    value_total = float(score.get("value_total_usd", 0) or 0)
    false_claims = int(score.get("false_claims", 0) or 0)
    ledger = [t for t in score.get("trap_ledger", []) or [] if isinstance(t, Mapping)]
    traps_total = int(score.get("traps_total", len(ledger)) or 0)
    traps_filed = int(score.get("traps_filed", 0) or 0)
    minutes = float(verdict.get("minutes", float(bench.get("wall_s", 0) or 0) / 60) or 0)
    manual = float(econ.get("manual_minutes", 0) or 0)
    word = str(verdict.get("word", "short"))
    reasons = [str(r) for r in verdict.get("reasons", []) or []]
    expected_raw = verdict.get("expected", {})
    expected = expected_raw if isinstance(expected_raw, Mapping) else {}

    intro = f"{title}."
    if persona:
        intro += f" This is a chore for {_spoken(_lower_first(persona)).rstrip('.')}."
    chore = _sentence(_spoken(_first_sentence(str(showcase.get("chore", "")))))
    if len(chore.split()) > CHORE_WORDS:
        chore = ""
    apps = [a for a in showcase.get("apps", []) or [] if isinstance(a, Mapping)]
    names = [re.sub(r"\s*\([^)]*\)", "", str(a.get("name", ""))).strip() for a in apps]
    names = [n for n in names if n]
    portals = (
        f"Athena works it across {_count(len(names), 'portal')}: {_and(names)}." if names else ""
    )

    found_line = f"On the bench, she found {found} of {eligible} eligible items"
    if value_total:
        found_line += f", worth {_dollars(value_found)} of the {_dollars(value_total)} there was"
        found_line += " to find"
    found_line += "."
    exact_line = (
        (f"All {found}" if exact == found else f"{exact} of the {found}")
        + " were filed at the exact amount the rules allow."
        if found and exact
        else ""
    )
    false_line = (
        "She made no false claim."
        if false_claims == 0
        else f"She made {_count(false_claims, 'false claim')}."
    )
    if traps_total:
        avoided = traps_total - traps_filed
        traps_line = f"The world held {_count(traps_total, 'trap')}, and she walked past {avoided}."
        if traps_filed:
            fell = [t for t in ledger if t.get("filed")]
            keys = _and([str(t.get("key", "")) for t in fell[:3] if t.get("key")])
            traps_line += f" She fell for {traps_filed}" + (f": {keys}." if keys else ".")
    else:
        traps_line = "The world held no trap for her."
    examples = [
        _sentence(_spoken(str(t))) for t in showcase.get("traps", []) or [] if str(t).strip()
    ]
    trap_words = f"Among them: {' '.join(examples[:2])}" if examples and traps_total else ""

    time_line = f"She took {_duration(minutes)}."
    if manual:
        time_line += f" By hand, the same chore takes {_duration(manual)}"
        if minutes >= 0.5 and manual / max(minutes, 0.5) >= 2:
            time_line += f", so she was about {round(manual / max(minutes, 0.5)):,} times faster"
        time_line += "."

    bar = []
    if expected.get("recall") is not None:
        bar.append(f"{round(float(expected['recall']) * 100)} percent of the money")
    if expected.get("false_claims") is not None:
        n = int(expected["false_claims"])
        bar.append("no false claim" if n == 0 else f"at most {_count(n, 'false claim')}")
    if expected.get("minutes") is not None:
        bar.append(f"inside {_duration(float(expected['minutes']))}")
    bar_words = f" The bar was {_and(bar)}." if bar else ""
    if word == "exceeds":
        verdict_line = (
            f"The verdict: exceeds. She beat the bar this playbook set itself.{bar_words}"
        )
    elif word == "meets":
        verdict_line = (
            f"The verdict: meets. She cleared the bar this playbook set itself.{bar_words}"
        )
    else:
        why = "; ".join(reasons[:3])
        verdict_line = "The verdict: short." + (
            f" {_sentence(why[0].upper() + why[1:])}" if why else ""
        )
    caveat_raw = str(showcase.get("caveat", "")).strip()
    caveat = _sentence(_spoken(_first_sentence(caveat_raw))) if caveat_raw else ""
    closing = "Every card she filed waited for a person's signature, and nothing was sent."

    # Output order, with the optional parts named; then the optional ones in the order they are
    # added while there is time for them.
    order: list[tuple[str, str]] = [
        ("intro", intro),
        ("chore", chore),
        ("portals", portals),
        ("found", found_line),
        ("exact", exact_line),
        ("false", false_line),
        ("traps", traps_line),
        ("trap_words", trap_words),
        ("time", time_line),
        ("verdict", verdict_line),
        ("caveat", caveat),
        ("closing", closing),
    ]
    optional = ("chore", "portals", "trap_words", "exact", "caveat")
    chosen = {k for k, text in order if text and k not in optional}

    def text_of(keys: set[str]) -> str:
        return " ".join(text for k, text in order if k in keys and text)

    for key in optional:
        part = dict(order)[key]
        if part and estimate_seconds(text_of(chosen | {key})) <= TARGET_SECONDS[1]:
            chosen.add(key)
    return text_of(chosen)


# --- tools -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Tools:
    ffmpeg: str
    ffprobe: str
    node: str


def find_tools(
    environ: Mapping[str, str] | None = None, which: Callable[[str], str | None] = shutil.which
) -> Tools:
    """ffmpeg (``$FFMPEG`` else PATH), ffprobe (``$FFPROBE``, beside ffmpeg, else PATH) and Node.

    A missing one raises :class:`EvidenceError` naming it, before any step has run.
    """
    env = os.environ if environ is None else environ
    ffmpeg = env.get("FFMPEG") or which("ffmpeg")
    if not ffmpeg:
        raise EvidenceError("ffmpeg is missing: put it on PATH or set FFMPEG")
    ffprobe = env.get("FFPROBE") or ""
    if not ffprobe:
        beside = Path(ffmpeg).with_name(f"ffprobe{Path(ffmpeg).suffix}")
        ffprobe = str(beside) if beside.is_file() else (which("ffprobe") or "")
    if not ffprobe:
        raise EvidenceError("ffprobe is missing: put it on PATH or set FFPROBE")
    node = which("node")
    if not node:
        raise EvidenceError("node is missing: the capture runs Playwright under Node")
    return Tools(ffmpeg=ffmpeg, ffprobe=ffprobe, node=node)


@dataclass(frozen=True)
class Voice:
    """The local engine that speaks the narration."""

    engine: str
    voice: str
    homes: EngineHomes


def _piper_paths(homes: EngineHomes) -> tuple[Path, Path]:
    return (
        homes.tts_bin / f"piper{EXE_SUFFIX}",
        homes.tts / "piper" / PIPER_VOICE / f"{PIPER_VOICE}.onnx",
    )


def choose_voice(homes: EngineHomes | None = None, *, check: bool = True) -> Voice:
    """Kokoro when it is ready; Piper only when Kokoro is not; else an error naming both."""
    homes = homes or resolve_homes()
    kokoro = probe_kokoro(homes, check=check)
    if kokoro.ready:
        return Voice("kokoro", KOKORO_VOICE, homes)
    exe, model = _piper_paths(homes)
    if exe.is_file() and model.is_file():
        return Voice("piper", PIPER_VOICE, homes)
    raise EvidenceError(
        f"kokoro is missing ({kokoro.reason}) and so is piper ({exe.name} with {model.name})"
    )


# --- 2. speech ---------------------------------------------------------------------------------


def _chunks(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Whole sentences, grouped under the engine's per-call limit."""
    out: list[str] = []
    for sentence in split_sentences(text):
        if out and len(out[-1]) + 1 + len(sentence) <= limit:
            out[-1] = f"{out[-1]} {sentence}"
        else:
            out.append(sentence[:limit])
    return out


def _write_wav(path: Path, pcm: bytes, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as wav:
        return wav.getnframes() / float(wav.getframerate())


def speak(voice: Voice, text: str, out: Path) -> float:
    """``text`` into a 16-bit mono WAV at ``out``, with a breath before and a beat after."""
    if voice.engine == "kokoro":
        spec = find_voice(voice.voice)
        if spec is None:
            raise EvidenceError(f"kokoro has no voice {voice.voice!r}")
        tts = KokoroTTS(voice.homes, voice=spec)
        try:
            body = b"".join(pcm for chunk in _chunks(text) for pcm in tts.synthesize(chunk))
        except VoiceBackendError as exc:
            raise EvidenceError(f"kokoro failed: {exc}") from None
        rate = KOKORO_RATE
    else:
        body, rate = _piper(voice.homes, text)
    silence = b"\x00\x00"
    _write_wav(out, silence * int(rate * LEAD_S) + body + silence * int(rate * TAIL_S), rate)
    return wav_seconds(out)


def _piper(homes: EngineHomes, text: str) -> tuple[bytes, int]:
    exe, model = _piper_paths(homes)
    with tempfile.TemporaryDirectory(prefix="athena-piper-") as tmp:
        wav_path = Path(tmp) / "out.wav"
        done = subprocess.run(
            [str(exe), "--model", str(model), "--output_file", str(wav_path)],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=600,
            creationflags=creation_flags(),
            check=False,
        )
        if done.returncode != 0 or not wav_path.is_file():
            snippet = done.stderr.decode("utf-8", "replace").strip()[:400]
            raise EvidenceError(f"piper exited with {done.returncode}: {snippet}")
        with wave.open(str(wav_path), "rb") as wav:
            return wav.readframes(wav.getnframes()), wav.getframerate()


# --- 3-5. capture, mux, index -------------------------------------------------------------------


def fixture_for(playbook_id: str) -> str:
    """The preview fixture that opens this playbook's layer (``modules/playbooks/fixtures.ts``)."""
    return f"shipped:{playbook_id}"


@dataclass(frozen=True)
class MediaPaths:
    dir: Path
    narration: Path
    capture: Path
    capture_log: Path
    result_png: Path
    video: Path
    thumb: Path
    index: Path


def media_paths(repo: Path, playbook_id: str) -> MediaPaths:
    media = repo / EVIDENCE_DIRNAME / playbook_id
    book = repo / PLAYBOOKS_DIRNAME / playbook_id
    return MediaPaths(
        dir=media,
        narration=media / "narration.wav",
        capture=media / "capture.webm",
        capture_log=media / "capture.json",
        result_png=media / "result.png",
        video=media / "evidence.mp4",
        thumb=book / "thumb.jpg",
        index=book / "evidence.json",
    )


def _rel(repo: Path, path: Path) -> str:
    return path.resolve().relative_to(repo.resolve()).as_posix()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _run(argv: Sequence[str], what: str, *, cwd: Path | None = None, timeout: float = 900) -> str:
    try:
        done = subprocess.run(
            list(argv),
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            creationflags=creation_flags(),
            check=False,
        )
    except FileNotFoundError:
        raise EvidenceError(f"{what} is missing: {Path(argv[0]).name} would not start") from None
    except subprocess.TimeoutExpired:
        raise EvidenceError(f"{what} did not finish within {timeout:.0f} s") from None
    if done.returncode != 0:
        tail = (done.stderr or done.stdout).decode("utf-8", "replace").strip()[-800:]
        raise EvidenceError(f"{what} exited with {done.returncode}: {tail}")
    return done.stdout.decode("utf-8", "replace")


def probe_seconds(tools: Tools, path: Path) -> float:
    out = _run(
        [
            tools.ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        "ffprobe",
    )
    return round(float(out.strip().splitlines()[0]), 3)


def capture(tools: Tools, repo: Path, playbook_id: str, seconds: float, media: MediaPaths) -> float:
    """Record the layer for ``seconds`` of walk; return where the walk starts in the webm."""
    _run(
        [
            tools.node,
            str(repo / CAPTURE_SCRIPT),
            "--fixture",
            fixture_for(playbook_id),
            "--seconds",
            f"{seconds:.2f}",
            "--out",
            str(media.dir),
        ],
        "the capture (node)",
        cwd=repo,
        timeout=seconds + 240,
    )
    if not media.capture.is_file() or not media.result_png.is_file():
        raise EvidenceError(f"the capture wrote no {media.capture.name} or {media.result_png.name}")
    log = json.loads(media.capture_log.read_text(encoding="utf-8"))
    return float(log.get("lead_s", 0.0))


def mux(tools: Tools, media: MediaPaths, lead_s: float, seconds: float) -> None:
    """The capture from ``lead_s`` on, under the narration, as H.264 + AAC for ``seconds``."""
    _run(
        [
            tools.ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{lead_s:.3f}",
            "-i",
            str(media.capture),
            "-i",
            str(media.narration),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            "tpad=stop_mode=clone:stop_duration=5,fps=25,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            "-af",
            "apad",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-t",
            f"{seconds:.3f}",
            "-movflags",
            "+faststart",
            str(media.video),
        ],
        "ffmpeg",
    )


def thumbnail(tools: Tools, media: MediaPaths) -> int:
    """The result view as a JPEG under :data:`THUMB_MAX_BYTES`, shrunk until it fits."""
    media.thumb.parent.mkdir(parents=True, exist_ok=True)
    for width, quality in THUMB_STEPS:
        _run(
            [
                tools.ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(media.result_png),
                "-vf",
                f"scale='min(iw,{width})':-2:flags=lanczos",
                "-frames:v",
                "1",
                "-q:v",
                str(quality),
                str(media.thumb),
            ],
            "ffmpeg",
        )
        size = media.thumb.stat().st_size
        if size < THUMB_MAX_BYTES:
            return size
    media.thumb.unlink(missing_ok=True)
    raise EvidenceError(
        f"no thumbnail under {THUMB_MAX_BYTES:,} bytes, even at {THUMB_STEPS[-1][0]} px wide"
    )


def _bench(book: Playbook) -> dict[str, Any]:
    path = book.root / "bench.json"
    if not path.is_file():
        raise EvidenceError(f"{book.id} has no bench.json: bench it before filming it")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise EvidenceError(f"{book.id}: bench.json is not an object")
    return value


def plan(book: Playbook, repo: Path) -> list[str]:
    """What :func:`build_evidence` would do, step by step, running nothing."""
    bench = _bench(book)
    text = narration(book.showcase, bench)
    media = media_paths(repo, book.id)
    turns = len(bench.get("trace", []) or [])
    return [
        f"{book.id}: bench run_at {bench.get('run_at')}, {turns} turns",
        f"  narration: {len(text.split())} words, about {estimate_seconds(text):.0f} s",
        f"  speech: kokoro {KOKORO_VOICE} (piper {PIPER_VOICE} if kokoro is missing) -> "
        f"{_rel(repo, media.narration)}",
        f"  capture: node {CAPTURE_SCRIPT} --fixture {fixture_for(book.id)} -> "
        f"{_rel(repo, media.capture)}",
        f"  mux: ffmpeg -> {_rel(repo, media.video)} (H.264 + AAC)",
        f"  thumbnail: ffmpeg -> {_rel(repo, media.thumb)} (< {THUMB_MAX_BYTES:,} bytes)",
        f"  index: {_rel(repo, media.index)} (schema {SCHEMA})",
    ]


def build_evidence(
    book: Playbook,
    repo: Path,
    tools: Tools,
    voice: Voice,
    *,
    echo: Callable[[str], None] = lambda _line: None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict[str, Any]:
    """Narrate, speak, capture, mux, thumbnail and index one benched playbook."""
    bench = _bench(book)
    text = narration(book.showcase, bench)
    media = media_paths(repo, book.id)
    media.dir.mkdir(parents=True, exist_ok=True)
    echo(f"{book.id}: speaking {len(text.split())} words with {voice.engine} {voice.voice}")
    spoken = speak(voice, text, media.narration)
    if not MIN_SECONDS <= spoken <= MAX_SECONDS + LEAD_S + TAIL_S:
        raise EvidenceError(
            f"{book.id}: the narration runs {spoken:.1f} s, outside {MIN_SECONDS:.0f} to "
            f"{MAX_SECONDS:.0f} s"
        )
    echo(f"{book.id}: capturing {spoken:.1f} s of the layer")
    lead = capture(tools, repo, book.id, spoken + 1.0, media)
    echo(f"{book.id}: muxing from {lead:.2f} s into the capture")
    mux(tools, media, lead, spoken)
    thumb_bytes = thumbnail(tools, media)
    index: dict[str, Any] = {
        "schema": SCHEMA,
        "playbook": book.id,
        "captured_at": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bench_run_at": bench.get("run_at"),
        "narration": {
            "text": text,
            "engine": voice.engine,
            "voice": voice.voice,
            "duration_s": round(spoken, 3),
            "sha256": sha256(media.narration),
        },
        "video": {
            "path": _rel(repo, media.video),
            "duration_s": probe_seconds(tools, media.video),
            "bytes": media.video.stat().st_size,
            "sha256": sha256(media.video),
        },
        "thumbnail": {
            "path": _rel(repo, media.thumb),
            "bytes": thumb_bytes,
            "sha256": sha256(media.thumb),
        },
    }
    # LF on every machine, as git keeps it: the index is the same bytes wherever it was written.
    media.index.write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    echo(f"{book.id}: {_rel(repo, media.index)}")
    return index


# --- verify ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Standing:
    playbook: str
    #: ``current``, ``stale``, ``missing``, ``unbenched`` or ``unreadable`` (``bench.json`` or
    #: ``evidence.json`` is not a JSON object; the notes name the file and the problem).
    state: str
    notes: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.state in ("current", "unbenched") and not self.notes


def _read_object(path: Path) -> tuple[dict[str, Any] | None, str]:
    """A JSON object from ``path``, else ``None`` and a sentence naming the file and the problem."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:  # JSONDecodeError and UnicodeDecodeError are ValueErrors
        return None, f"{path.name} cannot be read: {type(exc).__name__}: {exc}"
    if not isinstance(data, dict):
        return None, f"{path.name} is not a JSON object (found {type(data).__name__})"
    return data, ""


def verify(books: Iterable[Playbook], repo: Path) -> list[Standing]:
    """Each playbook's evidence against its bench, and its media against the hashes recorded."""
    out: list[Standing] = []
    for book in books:
        bench_path = book.root / "bench.json"
        index_path = book.root / "evidence.json"
        if not bench_path.is_file():
            out.append(Standing(book.id, "unbenched"))
            continue
        if not index_path.is_file():
            out.append(Standing(book.id, "missing"))
            continue
        bench, bench_fault = _read_object(bench_path)
        index, index_fault = _read_object(index_path)
        if bench is None or index is None:
            faults = tuple(f for f in (bench_fault, index_fault) if f)
            out.append(Standing(book.id, "unreadable", faults))
            continue
        state = "current" if index.get("bench_run_at") == bench.get("run_at") else "stale"
        notes: list[str] = []
        narrated = media_paths(repo, book.id).narration
        # The film and its sound stay on the machine that made them; the thumbnail is committed,
        # so only its absence is a fault.
        for part, required in (("narration", False), ("video", False), ("thumbnail", True)):
            found = index.get(part)
            entry: dict[str, Any] = found if isinstance(found, dict) else {}
            where = str(entry.get("path", "")) or (
                _rel(repo, narrated) if part == "narration" else ""
            )
            path = repo / where if where else None
            if path is not None and path.is_file():
                if sha256(path) != entry.get("sha256"):
                    notes.append(f"{where} does not match its sha256")
            elif required:
                notes.append(f"{where or part} is missing")
        if state == "current" and index.get("narration", {}).get("text") != narration(
            book.showcase, bench
        ):
            notes.append("the narration no longer says what the record says: film it again")
        out.append(Standing(book.id, state, tuple(notes)))
    return out
