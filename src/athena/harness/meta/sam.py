"""SAM 3.1 as the ``meta`` Segmenter: every match of a noun phrase, boxed (spike 00 piece 2).

One still or one clip goes to ``POST {base}/responses`` with the text prompt and any prompt boxes;
the reply's segments become :class:`~athena.senses.contract.Segment` rows with boxes normalised to
0..1 of the frame. A still bills one ``image``; a clip bills its frames with SAM's 50-frame minimum
per video request (:func:`~athena.harness.meta.prices.cost_of`).

**Press, not measured; the P1 probe replaces.** Meta states that SAM is served over Responses and
nothing more (``meta-model-facts.md`` "Endpoint shape": the SAM schema is unstated). The request
parts (``input_image`` / ``input_video`` / ``input_boxes``) and the reply's ``segments`` list are
guesses in the Responses convention, isolated in :func:`segment_payload` and
:func:`parse_segments`. Boxes are read as ``[x0, y0, x1, y1]``; a box with a coordinate past 1 is
taken as pixels and divided by the frame size (the picture header, else ``params`` width/height).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from athena.harness.meta.config import REQUEST_TIMEOUT_S, SAM_MODEL, base_url
from athena.harness.meta.guard import mode_of, require_standard
from athena.harness.meta.prices import cost_of
from athena.harness.meta.wire import (
    MetaShapeError,
    data_url,
    mime_of,
    post_json,
    require_file,
    require_key,
)
from athena.harness.tokenfactory import HttpPost, urllib_post
from athena.harness.vision import sniff_image
from athena.senses.contract import Box, Segment, SegmentRequest, SenseCall

__all__ = ["MetaSegmenter", "parse_segments", "segment_payload"]

_WHAT = "SAM"


def segment_payload(
    model: str, data: bytes, mime: str, prompt: str, boxes: Sequence[Box] = ()
) -> dict[str, Any]:
    """The ``/responses`` body for one still or clip (press shape)."""
    url = data_url(data, mime)
    media: dict[str, Any] = (
        {"type": "input_video", "video_url": url}
        if mime.startswith("video/")
        else {"type": "input_image", "image_url": url}
    )
    content: list[dict[str, Any]] = [media, {"type": "input_text", "text": prompt}]
    if boxes:
        content.append({"type": "input_boxes", "boxes": [b.as_list() for b in boxes]})
    return {"model": model, "input": [{"role": "user", "content": content}]}


def _raw_segments(reply: Mapping[str, Any]) -> list[Any]:
    top = reply.get("segments")
    if isinstance(top, list):
        return top
    output = reply.get("output")
    if isinstance(output, list):
        found = [
            s
            for item in output
            if isinstance(item, Mapping) and isinstance(item.get("segments"), list)
            for s in item["segments"]
        ]
        if found or any(isinstance(i, Mapping) and "segments" in i for i in output):
            return found
    raise MetaShapeError("segments (top level or output[].segments)", _WHAT)


def _box(raw: Any, size: tuple[int, int] | None, at: int) -> Box:
    if not (isinstance(raw, list) and len(raw) == 4):
        raise MetaShapeError(f"segments[{at}].box as [x0, y0, x1, y1]", _WHAT)
    try:
        x0, y0, x1, y1 = (float(v) for v in raw)
    except (TypeError, ValueError):
        raise MetaShapeError(f"segments[{at}].box as numbers", _WHAT) from None
    if max(x0, y0, x1, y1) > 1.0:
        if size is None:
            raise MetaShapeError(
                f"segments[{at}].box normalised (pixels, frame size unknown)", _WHAT
            )
        width, height = size
        x0, x1, y0, y1 = x0 / width, x1 / width, y0 / height, y1 / height

    def clamp(v: float) -> float:
        return min(max(v, 0.0), 1.0)

    return Box(clamp(x0), clamp(y0), clamp(x1), clamp(y1))


def parse_segments(
    reply: Mapping[str, Any], prompt: str, size: tuple[int, int] | None = None
) -> list[Segment]:
    """A SAM reply as segments. ``size`` is the frame's ``(width, height)`` for pixel boxes."""
    out: list[Segment] = []
    for at, raw in enumerate(_raw_segments(reply)):
        if not isinstance(raw, Mapping):
            raise MetaShapeError(f"segments[{at}] as an object", _WHAT)
        box_raw = raw.get("box", raw.get("bbox"))
        score = raw.get("score", raw.get("confidence", 1.0))
        frame = raw.get("frame", raw.get("frame_index", 0))
        track = raw.get("track_id", raw.get("object_id"))
        try:
            score_f, frame_i = float(score), int(frame)
        except (TypeError, ValueError):
            raise MetaShapeError(f"segments[{at}].score/frame as numbers", _WHAT) from None
        out.append(
            Segment(
                label=str(raw.get("label") or raw.get("phrase") or prompt),
                score=score_f,
                box=_box(box_raw, size, at),
                frame=frame_i,
                track_id=str(track) if track is not None else None,
            )
        )
    return out


def _size(data: bytes, params: Mapping[str, Any]) -> tuple[int, int] | None:
    sniffed = sniff_image(data)
    if sniffed is not None:
        return sniffed[1], sniffed[2]
    width, height = params.get("width"), params.get("height")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        return width, height
    return None


class MetaSegmenter:
    """The ``meta`` :class:`~athena.senses.contract.Segmenter` over ``sam-3.1``."""

    def __init__(
        self,
        *,
        env: Mapping[str, str] | None = None,
        post: HttpPost = urllib_post,
        model: str = SAM_MODEL,
        timeout_s: float = REQUEST_TIMEOUT_S,
    ) -> None:
        self.env, self.post = env, post
        self.model, self.timeout_s = model, timeout_s

    def segment(self, request: SegmentRequest) -> tuple[list[Segment], SenseCall]:
        media = request.media
        require_standard(self.model, media.personal)
        key = require_key(self.env)
        data = require_file(request.file, media.id)
        mime = mime_of(request.file) if request.file is not None else ""
        payload = segment_payload(self.model, data, mime, request.prompt, request.boxes)
        url = base_url(self.env) + "/responses"
        reply, latency_ms = post_json(self.post, url, key, payload, self.timeout_s, _WHAT)
        segments = parse_segments(reply, request.prompt, _size(data, media.params))
        unit: Literal["image", "frame"]
        if media.kind == "video":
            declared = media.params.get("frames")
            units = float(
                declared if isinstance(declared, int) else len({s.frame for s in segments}) or 1
            )
            unit = "frame"
        else:
            units, unit = 1.0, "image"
        cost = cost_of(self.model, units, unit)
        call = SenseCall(
            sense=media.sense,
            role="segment",
            backend="meta",
            model=self.model,
            mode=mode_of(self.model),
            media_id=media.id,
            units=units,
            unit=unit,
            cost_usd=cost,
            cost_estimated=True,
            latency_ms=latency_ms,
        )
        return segments, call
