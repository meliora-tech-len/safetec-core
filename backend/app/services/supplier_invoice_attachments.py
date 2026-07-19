"""Storage for physical supplier-invoice documents.

Files are stored PRIVATELY (never on a public URL) — these are sensitive financial
documents, so the bytes are only ever streamed back through an authenticated
endpoint. Local dev writes to a private uploads dir on disk; production stores the
object in a private Supabase bucket. Extracted from the supplier-invoices route so
other modules (e.g. the subcontractor costing export bundle) can read the same
files without importing route internals.
"""

import os
import httpx
from pathlib import Path

from fastapi import HTTPException

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ATTACH_BUCKET = "supplier-invoices"

DATABASE_URL = os.getenv("DATABASE_URL", "")
IS_LOCAL = DATABASE_URL.startswith("sqlite") or not SUPABASE_URL

# Private uploads dir — deliberately NOT under static/ (which is mounted at /static)
# so the files are never publicly reachable.
LOCAL_ATTACH_DIR = Path(__file__).resolve().parents[3] / "uploads" / "supplier-invoices"

ALLOWED_ATTACH_TYPES = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
}
# Fallback by file extension, used when the browser/OS reports an unhelpful
# content_type (e.g. application/octet-stream, application/x-pdf) — which happens
# for some PDFs and for most .xlsx/.xls files. Keeps a stray MIME type from
# blocking an otherwise-valid upload.
ALLOWED_ATTACH_EXTS = {
    "pdf": ("pdf", "application/pdf"),
    "png": ("png", "image/png"),
    "jpg": ("jpg", "image/jpeg"),
    "jpeg": ("jpg", "image/jpeg"),
    "webp": ("webp", "image/webp"),
    "xlsx": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "xls": ("xls", "application/vnd.ms-excel"),
}
MAX_ATTACH_BYTES = 25 * 1024 * 1024  # 25 MB


def resolve_attach_type(content_type: str | None, filename: str | None):
    """Determine (ext, content_type) for an upload, preferring the reported MIME
    type but falling back to the filename extension when the MIME type is missing
    or unrecognised. Returns (None, None) if neither is acceptable."""
    ext = ALLOWED_ATTACH_TYPES.get((content_type or "").lower())
    if ext:
        return ext, content_type
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    if suffix in ALLOWED_ATTACH_EXTS:
        return ALLOWED_ATTACH_EXTS[suffix]
    return None, None


def save_attachment(invoice_id: int, file_bytes: bytes, ext: str, content_type: str) -> str:
    """Persist the file and return its storage key (deterministic per invoice, so a
    re-upload overwrites the previous file)."""
    key = f"si_{invoice_id}.{ext}"
    if IS_LOCAL:
        LOCAL_ATTACH_DIR.mkdir(parents=True, exist_ok=True)
        (LOCAL_ATTACH_DIR / key).write_bytes(file_bytes)
    else:
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        resp = httpx.put(
            upload_url, content=file_bytes,
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"Attachment upload failed: {resp.text}")
    return key


def read_attachment(key: str) -> bytes:
    """Read the stored file bytes (local disk or private Supabase object)."""
    if IS_LOCAL:
        path = LOCAL_ATTACH_DIR / key
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Attachment file not found")
        return path.read_bytes()
    download_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
    resp = httpx.get(download_url, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"})
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return resp.content


def delete_attachment(key: str) -> None:
    """Remove the stored file. Best-effort: clearing the DB metadata is what matters."""
    if IS_LOCAL:
        try:
            (LOCAL_ATTACH_DIR / key).unlink(missing_ok=True)
        except OSError:
            pass
    else:
        delete_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        try:
            httpx.request(
                "DELETE", delete_url,
                headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            )
        except httpx.HTTPError:
            pass
