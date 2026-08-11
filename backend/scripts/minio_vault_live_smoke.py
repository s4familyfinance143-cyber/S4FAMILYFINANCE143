"""Live smoke: API document vault on MinIO — vault-status + encrypt roundtrip via API."""

from __future__ import annotations

import json
import sys
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API = "http://127.0.0.1:8000/api/v1"
EMAIL = "owner@s4family.com"
PASSWORD = "S4Family143!"


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=60) as res:
        raw = res.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def multipart_upload(item_id: str, family_id: str, token: str, filename: str, content: bytes) -> dict:
    boundary = f"----S4Boundary{uuid.uuid4().hex}"
    parts = [
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="family_id"\r\n\r\n'
            f"{family_id}\r\n"
        ).encode(),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
        ).encode()
        + content
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    req = Request(
        f"{API}/phase16/{item_id}/upload",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> int:
    login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    token = login["access_token"]

    vault = http_json("GET", "/phase16/vault-status", token=token)
    assert vault.get("backend") == "s3", vault
    assert vault.get("s3_configured") is True, vault
    print("PASS vault-status backend=s3")

    ensure = http_json("POST", "/phase16/vault-ensure-bucket", token=token)
    assert ensure.get("ok") is True, ensure
    print("PASS ensure-bucket", ensure.get("bucket"))

    families = http_json("GET", "/families", token=token)
    family_list = families if isinstance(families, list) else families.get("families") or []
    family_id = family_list[0]["id"]

    item = http_json(
        "POST",
        "/phase16",
        token=token,
        body={
            "family_id": family_id,
            "module_type": "DOCUMENT",
            "name": f"MinIO Live Smoke {uuid.uuid4().hex[:8]}",
            "category": "ID",
            "sub_type": "NID",
            "amount": "0",
            "currency": "BDT",
            "renewal_or_expiry_date": "2030-12-31",
            "reference": "MINIO-LIVE",
            "note": "minio live vault smoke",
        },
    )
    item_id = item["id"]
    assert item_id, item

    payload = b"minio-live-vault-bytes-2026"
    uploaded = multipart_upload(item_id, family_id, token, "minio-live.txt", payload)
    assert uploaded.get("has_file") is True, uploaded
    assert uploaded.get("file_encrypted") is True, uploaded
    print("PASS upload has_file encrypted")

    # Confirm object landed in MinIO (API response does not expose internal file_path)
    import boto3
    from botocore.client import Config

    s3 = boto3.client(
        "s3",
        endpoint_url="http://127.0.0.1:9002",
        aws_access_key_id="s4minio",
        aws_secret_access_key="s4_minio_local_2026",
        region_name="us-east-1",
        config=Config(signature_version="s3v4"),
    )
    listed = s3.list_objects_v2(Bucket="s4-family-finance", Prefix=f"{family_id}/{item_id}")
    keys = [o["Key"] for o in listed.get("Contents") or []]
    assert keys, listed
    print("PASS minio object", keys[0])

    req = Request(
        f"{API}/phase16/{item_id}/download?family_id={family_id}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=60) as res:
        data = res.read()
    assert data == payload, (len(data), data[:40])
    print("PASS download roundtrip", len(data), "bytes")
    print("PASS minio_vault_live_smoke")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HTTPError as exc:
        print("HTTP FAIL", exc.code, exc.read().decode("utf-8", errors="ignore"), file=sys.stderr)
        raise SystemExit(1) from exc
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc, file=sys.stderr)
        raise SystemExit(1) from exc
