"""Draw-to-Edit backend: Seedance video generation + reference-video editing via BytePlus ModelArk."""

import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from byteplussdkarkruntime import Ark

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

MEDIA_DIR = BASE_DIR / "media"
MEDIA_DIR.mkdir(exist_ok=True)

MODELS = [
    {
        "id": "dreamina-seedance-2-5-260628",
        "name": "Seedance 2.5",
        "max_duration": 30,
        "resolutions": ["480p", "720p", "1080p"],
        "default": True,
        "reference_limits": {"Image": 30, "Video": 10, "Audio": 10},
        "reference_max_seconds": {"Video": 30, "Audio": 30},  # combined duration per type
    },
    {
        "id": "dreamina-seedance-2-0-260128",
        "name": "Seedance 2.0",
        "max_duration": 15,
        "resolutions": ["480p", "720p", "1080p", "4k"],
        "reference_limits": {"Image": 9, "Video": 3, "Audio": 3},
    },
    {
        "id": "dreamina-seedance-2-0-fast-260128",
        "name": "Seedance 2.0 fast",
        "max_duration": 15,
        "resolutions": ["480p", "720p"],
        "reference_limits": {"Image": 9, "Video": 3, "Audio": 3},
    },
    {
        "id": "dreamina-seedance-2-0-mini-260615",
        "name": "Seedance 2.0 mini",
        "max_duration": 15,
        "resolutions": ["480p", "720p"],
        "reference_limits": {"Image": 9, "Video": 3, "Audio": 3},
    },
]
MODELS_BY_ID = {m["id"]: m for m in MODELS}

# Edit-mode constraints from the API docs.
EDIT_MIN_SECONDS = 4
EDIT_MAX_SECONDS = 30
EDIT_KEYWORDS = re.compile(
    r"edit the video|\badd\b|\bdelete\b|\bremove\b|\bmodify\b|\breplace\b|\bchange\b",
    re.IGNORECASE,
)


def get_client() -> Ark:
    api_key = os.environ.get("ARK_API_KEY")
    if not api_key:
        raise HTTPException(500, "ARK_API_KEY is not set. Add it to backend/.env and restart the server.")
    return Ark(
        api_key=api_key,
        base_url=os.environ.get("ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3"),
    )


def api_error(e: Exception) -> HTTPException:
    msg = getattr(e, "message", None) or str(e)
    status = getattr(e, "status_code", None) or 502
    return HTTPException(status, msg)


def probe_duration(path: Path) -> Optional[float]:
    """Return a media file's duration in seconds using ffprobe, or None if unavailable."""
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return None


def download_to_media(url: str, name: str) -> Path:
    dest = MEDIA_DIR / name
    if dest.exists():
        return dest
    tmp = dest.with_suffix(".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    tmp.rename(dest)
    return dest


app = FastAPI(title="Draw to Edit")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

from assets import assets_enabled, host_publicly, router as assets_router, tos_enabled  # noqa: E402

app.include_router(assets_router)


@app.get("/api/health")
def health():
    return {"ok": True, "api_key_set": bool(os.environ.get("ARK_API_KEY")), "assets_enabled": assets_enabled(), "upload_enabled": tos_enabled()}


@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)):
    """Host a reference file in TOS and return a temporary public URL Seedance can fetch."""
    data = await file.read()
    ctype = file.content_type or "application/octet-stream"
    ext = Path(file.filename or "").suffix
    kind = "Video" if ctype.startswith("video/") else "Audio" if ctype.startswith("audio/") else "Image"
    duration = None
    if kind != "Image":
        tmp = MEDIA_DIR / f"probe-{uuid.uuid4().hex}{ext}"
        try:
            tmp.write_bytes(data)
            duration = probe_duration(tmp)
        finally:
            tmp.unlink(missing_ok=True)
    url = host_publicly(data, ctype, ext)
    return {"url": url, "type": kind, "duration": duration}


@app.get("/api/models")
def list_models():
    return MODELS


class GenerateRequest(BaseModel):
    model: str
    prompt: str = Field(min_length=1)
    image_url: Optional[str] = None  # optional first-frame image (URL or data URL)
    # Reference media in prompt order:
    # [{"url": "https://…" | "data:image/…" | "asset://…", "type": "Image|Video|Audio", "duration": seconds?}]
    references: List[dict] = []
    resolution: str = "720p"
    ratio: str = "16:9"
    duration: int = 5
    generate_audio: bool = True
    watermark: bool = False
    seed: Optional[int] = None


@app.post("/api/generate")
def generate(req: GenerateRequest):
    model = MODELS_BY_ID.get(req.model)
    if not model:
        raise HTTPException(400, f"Unknown model {req.model}")
    if req.duration != -1 and not (4 <= req.duration <= model["max_duration"]):
        raise HTTPException(400, f"{model['name']} supports 4–{model['max_duration']}s")

    content: List[dict] = [{"type": "text", "text": req.prompt}]
    if req.image_url:
        content.append({"type": "image_url", "image_url": {"url": req.image_url}, "role": "first_frame"})
    limits = model["reference_limits"]
    max_seconds = model.get("reference_max_seconds", {})
    counts = {"Image": 0, "Video": 0, "Audio": 0}
    seconds = {"Video": 0.0, "Audio": 0.0}
    for ref in req.references:
        uri, kind = ref.get("url", ""), ref.get("type", "Image")
        if kind not in counts:
            raise HTTPException(400, f"Unknown reference type {kind!r}")
        if not uri.startswith(("https://", "http://", "asset://")) and not (kind == "Image" and uri.startswith("data:image/")):
            raise HTTPException(400, f"{kind} references must be a public URL or asset:// (got {uri[:40]!r})")
        counts[kind] += 1
        if counts[kind] > limits[kind]:
            raise HTTPException(400, f"{model['name']} accepts at most {limits[kind]} reference {kind.lower()}s")
        if kind in seconds and ref.get("duration"):
            seconds[kind] += float(ref["duration"])
            if kind in max_seconds and seconds[kind] > max_seconds[kind] + 0.5:
                raise HTTPException(
                    400, f"{model['name']}: reference {kind.lower()}s total {seconds[kind]:.1f}s (max {max_seconds[kind]}s)"
                )
        if kind == "Video":
            content.append({"type": "video_url", "video_url": {"url": uri}, "role": "reference_video"})
        elif ref.get("type") == "Audio":
            content.append({"type": "audio_url", "audio_url": {"url": uri}, "role": "reference_audio"})
        else:
            content.append({"type": "image_url", "image_url": {"url": uri}, "role": "reference_image"})

    try:
        resp = get_client().content_generation.tasks.create(
            model=req.model,
            content=content,
            generate_audio=req.generate_audio,
            resolution=req.resolution,
            ratio=req.ratio,
            duration=req.duration,
            watermark=req.watermark,
            seed=req.seed,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise api_error(e)
    return {"task_id": resp.id}


class EditRequest(BaseModel):
    model: str
    prompt: str = Field(min_length=1)
    reference_video_url: str  # public URL or asset:// of the source video (role=reference_video)
    reference_image: str  # annotated frame: data URL, public URL or asset:// (role=reference_image)
    object_image: Optional[str] = None  # optional object to swap in or add (second reference_image)
    local_video: Optional[str] = None  # filename under /media, used to verify the 4–30s duration
    resolution: str = "720p"
    generate_audio: bool = True
    watermark: bool = False


@app.post("/api/edit")
def edit(req: EditRequest):
    if req.model not in MODELS_BY_ID:
        raise HTTPException(400, f"Unknown model {req.model}")
    if not EDIT_KEYWORDS.search(req.prompt):
        raise HTTPException(
            400,
            "Edit prompt must contain one of: 'edit the video', 'add', 'delete/remove', 'modify/replace/change'.",
        )

    if req.local_video:
        local = MEDIA_DIR / Path(req.local_video).name
        if local.exists():
            dur = probe_duration(local)
            if dur is not None and not (EDIT_MIN_SECONDS <= dur <= EDIT_MAX_SECONDS + 0.5):
                raise HTTPException(
                    400, f"Reference video is {dur:.1f}s; it must be {EDIT_MIN_SECONDS}–{EDIT_MAX_SECONDS}s long."
                )

    content = [
        {"type": "text", "text": req.prompt},
        {"type": "video_url", "video_url": {"url": req.reference_video_url}, "role": "reference_video"},
        {"type": "image_url", "image_url": {"url": req.reference_image}, "role": "reference_image"},
    ]
    if req.object_image:
        content.append({"type": "image_url", "image_url": {"url": req.object_image}, "role": "reference_image"})

    try:
        resp = get_client().content_generation.tasks.create(
            model=req.model,
            content=content,
            omni_reference_task_type="edit",
            ratio="adaptive",
            duration=-1,
            resolution=req.resolution,
            generate_audio=req.generate_audio,
            watermark=req.watermark,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise api_error(e)
    return {"task_id": resp.id}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    try:
        task = get_client().content_generation.tasks.get(task_id=task_id)
    except HTTPException:
        raise
    except Exception as e:
        raise api_error(e)

    data = task.model_dump() if hasattr(task, "model_dump") else dict(task)
    result = {
        "id": task_id,
        "status": data.get("status"),
        "model": data.get("model"),
        "error": (data.get("error") or {}).get("message") if data.get("error") else None,
        "video_url": None,
        "local_video": None,
        "duration": data.get("duration"),
        "resolution": data.get("resolution"),
        "ratio": data.get("ratio"),
    }

    video_url = (data.get("content") or {}).get("video_url")
    if result["status"] == "succeeded" and video_url:
        result["video_url"] = video_url
        # Keep a same-origin copy so the browser can read frames from it without CORS taint.
        try:
            path = download_to_media(video_url, f"{task_id}.mp4")
            result["local_video"] = path.name
            dur = probe_duration(path)
            if dur:
                result["duration"] = dur
        except Exception as e:
            result["download_error"] = str(e)
    return result


class ImportRequest(BaseModel):
    url: str


@app.post("/api/import")
def import_video(req: ImportRequest):
    """Import an existing, publicly reachable video so it can be drawn on and edited."""
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(400, "Video URL must be public (http/https) so the API can fetch it.")
    name = f"import-{uuid.uuid4().hex[:12]}.mp4"
    try:
        path = download_to_media(req.url, name)
    except Exception as e:
        raise HTTPException(400, f"Could not download video: {e}")
    return {"local_video": path.name, "video_url": req.url, "duration": probe_duration(path)}
