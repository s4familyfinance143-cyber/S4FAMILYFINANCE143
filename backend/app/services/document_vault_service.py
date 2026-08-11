"""Document vault storage — encrypted at rest.

Backends:
- local disk (default): backend/storage/document_vault
- S3/MinIO when S3_* env is fully set (or DOCUMENT_VAULT_BACKEND=s3)

Never pretends cloud storage is enabled without real credentials.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import uuid
from pathlib import Path

from app.core.config import settings

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
ALLOWED_MIME_EXACT = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
}
S3_PATH_PREFIX = "s3:"


def vault_root() -> Path:
    env_root = os.getenv("DOCUMENT_VAULT_ROOT")
    if env_root:
        path = Path(env_root)
    else:
        backend_root = Path(__file__).resolve().parents[2]
        path = backend_root / "storage" / "document_vault"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        return None

    raw = (os.getenv("DOCUMENT_VAULT_KEY") or settings.JWT_SECRET_KEY or "dev-vault-key").encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def is_s3_configured() -> bool:
    return bool(
        (settings.S3_ENDPOINT_URL or "").strip()
        and (settings.S3_BUCKET or "").strip()
        and (settings.S3_ACCESS_KEY or "").strip()
        and (settings.S3_SECRET_KEY or "").strip()
    )


def _boto3_available() -> bool:
    try:
        import boto3  # noqa: F401
        return True
    except ImportError:
        return False


def active_storage_backend() -> str:
    forced = (getattr(settings, "DOCUMENT_VAULT_BACKEND", None) or os.getenv("DOCUMENT_VAULT_BACKEND") or "auto").strip().lower()
    if forced == "local":
        return "local"
    if forced == "s3":
        return "s3" if is_s3_configured() else "local"
    return "s3" if is_s3_configured() else "local"


def object_storage_status() -> dict:
    endpoint = (settings.S3_ENDPOINT_URL or "").strip() or None
    bucket = (settings.S3_BUCKET or "").strip() or None
    configured = is_s3_configured()
    backend = active_storage_backend()
    note = (
        f"Document vault using {backend}"
        if backend == "local"
        else f"Document vault using S3/MinIO bucket={bucket}"
    )
    if not configured:
        note = (
            "S3/MinIO not configured. Set S3_ENDPOINT_URL, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY "
            "(and pip install boto3). Local encrypted disk vault remains active."
        )
    elif configured and not _boto3_available():
        note = "S3 env set but boto3 not installed. pip install boto3"
        configured = False
        backend = "local"
    return {
        "backend": backend,
        "s3_configured": configured and backend == "s3",
        "endpoint_url": endpoint,
        "bucket": bucket,
        "access_key_set": bool((settings.S3_ACCESS_KEY or "").strip()),
        "boto3_available": _boto3_available(),
        "local_root": str(vault_root()),
        "note": note,
    }


def _s3_client():
    if not is_s3_configured():
        raise RuntimeError("S3 not configured")
    if not _boto3_available():
        raise RuntimeError("boto3 not installed. pip install boto3")
    import boto3
    from botocore.client import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL.strip(),
        aws_access_key_id=settings.S3_ACCESS_KEY.strip(),
        aws_secret_access_key=settings.S3_SECRET_KEY.strip(),
        config=Config(signature_version="s3v4"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
    )


def ensure_s3_bucket() -> dict:
    """Create bucket if missing (MinIO/local). Honest fail if not configured."""
    status = object_storage_status()
    if not status["s3_configured"] and not is_s3_configured():
        return {"ok": False, "reason": status["note"], **status}
    if not _boto3_available():
        return {"ok": False, "reason": "boto3 not installed", **status}
    client = _s3_client()
    bucket = settings.S3_BUCKET.strip()
    try:
        client.head_bucket(Bucket=bucket)
        return {"ok": True, "created": False, "bucket": bucket, **status}
    except Exception:
        try:
            client.create_bucket(Bucket=bucket)
            return {"ok": True, "created": True, "bucket": bucket, **object_storage_status()}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": f"Bucket ensure failed: {exc}", "bucket": bucket, **status}


def validate_upload(filename: str, content_type: str | None, size: int) -> None:
    if size <= 0:
        raise ValueError("Empty file")
    if size > MAX_DOCUMENT_BYTES:
        raise ValueError("File too large (max 10MB)")
    mime = (content_type or "application/octet-stream").lower()
    if mime not in ALLOWED_MIME_EXACT and not any(mime.startswith(p) for p in ("image/",)):
        raise ValueError(f"Unsupported file type: {mime}")
    if not filename or Path(filename).name != filename:
        raise ValueError("Invalid filename")


def _encrypt_payload(data: bytes) -> tuple[bytes, bool]:
    """Architecture: AES-256-GCM at rest for document blobs."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from app.core.field_encryption import _key_bytes

        key = _key_bytes()
        aes = AESGCM(key)
        nonce = os.urandom(12)
        ct = aes.encrypt(nonce, data, None)
        # magic + version + nonce + ciphertext
        return b"S4A1" + nonce + ct, True
    except Exception:
        fernet = _fernet()
        if fernet is not None:
            return fernet.encrypt(data), True
        if os.getenv("DOCUMENT_VAULT_ALLOW_PLAIN") != "1":
            raise RuntimeError("cryptography package required for encrypted document vault")
        return data, False


def _decrypt_payload(payload: bytes) -> bytes:
    if payload.startswith(b"S4A1") and len(payload) > 16:
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            from app.core.field_encryption import _key_bytes

            raw = payload[4:]
            nonce, ct = raw[:12], raw[12:]
            return AESGCM(_key_bytes()).decrypt(nonce, ct, None)
        except Exception:
            pass
    fernet = _fernet()
    if fernet is not None:
        try:
            return fernet.decrypt(payload)
        except Exception:
            return payload
    return payload


def store_document_file(*, family_id: str, item_id: str, filename: str, content_type: str | None, data: bytes) -> dict:
    validate_upload(filename, content_type, len(data))
    safe_name = Path(filename).name
    sha256 = hashlib.sha256(data).hexdigest()
    payload, encrypted = _encrypt_payload(data)
    stored_name = f"{item_id}_{uuid.uuid4().hex}.bin"
    backend = active_storage_backend()

    if backend == "s3":
        key = f"{family_id}/{stored_name}"
        client = _s3_client()
        client.put_object(
            Bucket=settings.S3_BUCKET.strip(),
            Key=key,
            Body=payload,
            ContentType="application/octet-stream",
            Metadata={
                "original-name": safe_name[:200],
                "sha256": sha256,
                "encrypted": "1" if encrypted else "0",
            },
        )
        file_path = f"{S3_PATH_PREFIX}{key}"
    else:
        family_dir = vault_root() / family_id
        family_dir.mkdir(parents=True, exist_ok=True)
        stored_path = family_dir / stored_name
        stored_path.write_bytes(payload)
        file_path = str(stored_path.relative_to(vault_root()))

    return {
        "file_name": safe_name,
        "file_path": file_path,
        "file_mime": (content_type or "application/octet-stream")[:120],
        "file_size": len(data),
        "file_sha256": sha256,
        "file_encrypted": encrypted,
        "storage_backend": backend,
    }


def load_document_file(relative_path: str, expected_sha256: str | None = None) -> bytes:
    if relative_path.startswith(S3_PATH_PREFIX):
        key = relative_path[len(S3_PATH_PREFIX) :]
        client = _s3_client()
        obj = client.get_object(Bucket=settings.S3_BUCKET.strip(), Key=key)
        payload = obj["Body"].read()
    else:
        path = vault_root() / relative_path
        if not path.exists() or not path.is_file():
            raise FileNotFoundError("Document file missing")
        payload = path.read_bytes()

    data = _decrypt_payload(payload)
    if expected_sha256:
        digest = hashlib.sha256(data).hexdigest()
        if not hmac.compare_digest(digest, expected_sha256):
            raise ValueError("Document integrity check failed")
    return data


def delete_document_file(relative_path: str | None) -> None:
    if not relative_path:
        return
    if relative_path.startswith(S3_PATH_PREFIX):
        if not is_s3_configured():
            return
        key = relative_path[len(S3_PATH_PREFIX) :]
        try:
            _s3_client().delete_object(Bucket=settings.S3_BUCKET.strip(), Key=key)
        except Exception:
            return
        return
    path = vault_root() / relative_path
    if path.exists() and path.is_file():
        path.unlink()


def generate_presigned_get_url(relative_path: str, expires_in: int = 3600) -> str | None:
    """Architecture: S3 presigned URL — never expose permanent public object URLs."""
    if not relative_path or not relative_path.startswith(S3_PATH_PREFIX):
        return None
    if not is_s3_configured():
        return None
    key = relative_path[len(S3_PATH_PREFIX) :]
    client = _s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET.strip(), "Key": key},
        ExpiresIn=max(60, int(expires_in)),
    )


def generate_presigned_put_url(*, family_id: str, filename: str, content_type: str | None = None, expires_in: int = 900) -> dict | None:
    """Presigned upload URL for direct-to-S3 puts (architecture File Access)."""
    if not is_s3_configured():
        return None
    safe_name = Path(filename).name
    stored_name = f"upload_{uuid.uuid4().hex}_{safe_name}"[:180]
    key = f"{family_id}/{stored_name}"
    client = _s3_client()
    params: dict = {"Bucket": settings.S3_BUCKET.strip(), "Key": key}
    if content_type:
        params["ContentType"] = content_type
    url = client.generate_presigned_url("put_object", Params=params, ExpiresIn=max(60, int(expires_in)))
    return {
        "upload_url": url,
        "file_path": f"{S3_PATH_PREFIX}{key}",
        "expires_in": int(expires_in),
    }
