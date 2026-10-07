"""ModelArk private asset library (real people / virtual characters) + TOS hosting for uploads.

Asset management uses signed BytePlus OpenAPI calls with IAM AK/SK (not the ARK API key).
CreateAsset only accepts a public HTTPS URL, so local files are first put in a TOS bucket and
passed as a short-lived pre-signed URL.
"""

import base64
import json
import mimetypes
import os
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import byteplussdkcore
from byteplussdkcore.rest import ApiException
from byteplussdkcore.universal import UniversalApi, UniversalInfo

MEDIA_DIR = Path(__file__).resolve().parent / "media"
OPENAPI_VERSION = "2024-01-01"

router = APIRouter(prefix="/api/assets")


# Alternative variable names accepted for each setting.
ENV_ALIASES = {
    "BYTEPLUS_ACCESS_KEY": ["BYTEPLUS_AK"],
    "BYTEPLUS_SECRET_KEY": ["BYTEPLUS_SK"],
    "ARK_PROJECT_NAME": ["ARK_PROJECT"],
    "TOS_BUCKET": ["TOS_BUCKET_NAME"],
}


def env(name: str, default: str = "") -> str:
    for key in [name, *ENV_ALIASES.get(name, [])]:
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return default


def project() -> str:
    return env("ARK_PROJECT_NAME", "default")


def assets_enabled() -> bool:
    return bool(env("BYTEPLUS_ACCESS_KEY") and env("BYTEPLUS_SECRET_KEY"))


def tos_enabled() -> bool:
    return assets_enabled() and bool(env("TOS_BUCKET"))


# ---------------------------------------------------------------- OpenAPI ---


def openapi(action: str, body: dict) -> dict:
    """Signed call to the ModelArk management API. Returns the unwrapped `Result`."""
    if not assets_enabled():
        raise HTTPException(400, "Asset library needs BYTEPLUS_ACCESS_KEY and BYTEPLUS_SECRET_KEY in backend/.env.")
    region = env("BYTEPLUS_REGION", "ap-southeast-1")
    conf = byteplussdkcore.Configuration()
    conf.ak = env("BYTEPLUS_ACCESS_KEY")
    conf.sk = env("BYTEPLUS_SECRET_KEY")
    conf.session_token = env("BYTEPLUS_SESSION_TOKEN")
    conf.region = region
    conf.host = env("ARK_OPENAPI_HOST", f"ark.{region}.byteplusapi.com")
    conf.auto_retry = False
    api = UniversalApi(byteplussdkcore.ApiClient(conf))
    info = UniversalInfo(
        method="POST", service="ark", version=OPENAPI_VERSION, action=action, content_type="application/json"
    )
    payload = {k: v for k, v in body.items() if v is not None}
    payload.setdefault("ProjectName", project())
    try:
        return api.do_call(info, payload) or {}
    except ApiException as e:
        raise HTTPException(e.status if 400 <= (e.status or 0) < 600 else 502, f"{action}: {openapi_error(e)}")
    except Exception as e:
        raise HTTPException(502, f"{action}: {e}")


def openapi_error(e: ApiException) -> str:
    try:
        err = json.loads(e.body)["ResponseMetadata"]["Error"]
        return f"{err.get('Code')}: {err.get('Message')}"
    except Exception:
        return e.reason or str(e)


# -------------------------------------------------------------------- TOS ---


def host_publicly(data: bytes, content_type: str, ext: str) -> str:
    """Upload bytes to TOS and return a pre-signed HTTPS GET URL (valid 1h)."""
    if not tos_enabled():
        raise HTTPException(
            400,
            "Uploading local files needs a TOS bucket (TOS_BUCKET in backend/.env) so the asset library can fetch them. "
            "Alternatively paste a public HTTPS URL.",
        )
    import tos

    region = env("TOS_REGION", env("BYTEPLUS_REGION", "ap-southeast-1"))
    client = tos.TosClientV2(
        env("BYTEPLUS_ACCESS_KEY"),
        env("BYTEPLUS_SECRET_KEY"),
        env("TOS_ENDPOINT", f"tos-{region}.bytepluses.com"),
        region,
        security_token=env("BYTEPLUS_SESSION_TOKEN") or None,
    )
    bucket = env("TOS_BUCKET")
    key = f"{env('TOS_PREFIX', 'draw-to-edit').strip('/')}/{uuid.uuid4().hex}{ext}"
    try:
        client.put_object(bucket, key, content=data, content_type=content_type)
        return client.pre_signed_url(tos.HttpMethodType.Http_Method_Get, bucket, key, expires=3600).signed_url
    except Exception as e:
        raise HTTPException(502, f"TOS upload failed: {e}")


def decode_data_url(data_url: str):
    m = re.match(r"data:([\w/+.-]+);base64,(.*)", data_url, re.S)
    if not m:
        raise HTTPException(400, "Invalid data URL")
    content_type = m.group(1)
    return base64.b64decode(m.group(2)), content_type, mimetypes.guess_extension(content_type) or ""


def asset_type_for(content_type: str) -> str:
    if content_type.startswith("video/"):
        return "Video"
    if content_type.startswith("audio/"):
        return "Audio"
    return "Image"


def asset_error(a: dict) -> Optional[str]:
    err = a.get("Error")
    if isinstance(err, dict):
        return err.get("Message") or err.get("Code")
    return a.get("FailReason") or a.get("ErrorMessage") or err


def summarize_asset(a: dict) -> dict:
    return {
        "id": a.get("Id"),
        "uri": f"asset://{a.get('Id')}" if a.get("Id") else None,
        "name": a.get("Name"),
        "type": a.get("AssetType"),
        "status": a.get("Status"),
        "group_id": a.get("GroupId"),
        "preview_url": a.get("URL"),  # temporary; only for thumbnails
        "moderation": a.get("Moderation"),
        "error": asset_error(a),
        "created_at": a.get("CreateTime") or a.get("CreatedAt"),
    }


# ----------------------------------------------------------------- Routes ---


@router.get("/config")
def config():
    return {
        "enabled": assets_enabled(),
        "upload_enabled": tos_enabled(),
        "default_group_id": env("ASSET_GROUP_ID") or None,
        "project": project(),
    }


@router.get("/groups")
def list_groups(group_type: str = "AIGC"):
    result = openapi("ListAssetGroups", {"Filter": {"GroupType": group_type}, "MaxResults": 100})
    return [
        {
            "id": g.get("Id"),
            "name": g.get("Name"),
            "type": g.get("GroupType", group_type),
            "description": g.get("Description"),
        }
        for g in result.get("Items") or []
    ]


class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None


@router.post("/groups")
def create_group(req: GroupCreate):
    result = openapi(
        "CreateAssetGroup", {"Name": req.name, "Description": req.description or req.name, "GroupType": "AIGC"}
    )
    return {"id": result.get("Id"), "name": req.name, "type": "AIGC"}


class VerifyStart(BaseModel):
    callback_url: Optional[str] = None


@router.post("/verify")
def start_verification(req: VerifyStart):
    """Start a real-person liveness check. The person opens the H5 link themselves."""
    callback = req.callback_url or env("ASSET_VERIFY_CALLBACK_URL", "https://www.byteplus.com")
    result = openapi("CreateVisualValidateSession", {"CallbackURL": callback})
    return {"token": result.get("BytedToken"), "h5_link": result.get("H5Link")}


@router.get("/verify/{token}")
def verification_result(token: str):
    result = openapi("GetVisualValidateResult", {"BytedToken": token})
    return {"group_id": result.get("GroupId"), "raw_status": result.get("Status")}


@router.get("")
def list_assets(group_id: str, group_type: str = "AIGC"):
    result = openapi(
        "ListAssets", {"Filter": {"GroupType": group_type, "GroupIds": [group_id]}, "MaxResults": 100}
    )
    return [summarize_asset(a) for a in result.get("Items") or []]


@router.get("/{asset_id}")
def get_asset(asset_id: str):
    return summarize_asset(openapi("GetAsset", {"Id": asset_id}))


def create_asset(group_id: str, url: str, asset_type: str, name: Optional[str]) -> dict:
    if not url.startswith("https://"):
        raise HTTPException(400, "The asset library only accepts public HTTPS URLs.")
    result = openapi(
        "CreateAsset",
        {"GroupId": group_id, "URL": url, "AssetType": asset_type, "Name": name or f"draw-to-edit-{uuid.uuid4().hex[:6]}"},
    )
    asset_id = result.get("Id")
    return {"id": asset_id, "uri": f"asset://{asset_id}", "status": "Processing", "type": asset_type, "name": name}


class AssetCreate(BaseModel):
    group_id: str
    name: Optional[str] = None
    url: Optional[str] = None  # public HTTPS URL
    data_url: Optional[str] = None  # e.g. the marked frame; hosted on TOS first
    local_video: Optional[str] = None  # file in backend/media; hosted on TOS first
    asset_type: Optional[str] = None  # Image | Video | Audio (inferred when omitted)


@router.post("")
def create_asset_json(req: AssetCreate):
    if req.url:
        url = req.url
        ctype = mimetypes.guess_type(url.split("?")[0])[0] or ""
    elif req.data_url:
        data, ctype, ext = decode_data_url(req.data_url)
        url = host_publicly(data, ctype, ext)
    elif req.local_video:
        path = MEDIA_DIR / Path(req.local_video).name
        if not path.exists():
            raise HTTPException(404, "Local video not found")
        ctype = "video/mp4"
        url = host_publicly(path.read_bytes(), ctype, ".mp4")
    else:
        raise HTTPException(400, "Provide url, data_url or local_video")
    return create_asset(req.group_id, url, req.asset_type or asset_type_for(ctype), req.name)


@router.post("/upload")
async def upload_asset(group_id: str = Form(...), name: Optional[str] = Form(None), file: UploadFile = File(...)):
    data = await file.read()
    ctype = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    ext = Path(file.filename or "").suffix or mimetypes.guess_extension(ctype) or ""
    url = host_publicly(data, ctype, ext)
    return create_asset(group_id, url, asset_type_for(ctype), name or Path(file.filename or "").stem)
