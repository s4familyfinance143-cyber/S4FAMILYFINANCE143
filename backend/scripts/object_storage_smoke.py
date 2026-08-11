"""Smoke: object storage / document vault — honest local default + optional MinIO."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = "http://127.0.0.1:8000/api/v1"
ACCOUNTS = [
    ("owner@s4family.com", "S4Family143!"),
    ("pgcutover@s4family.com", "Test1234!"),
]


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> None:
    from app.services.document_vault_service import (
        active_storage_backend,
        is_s3_configured,
        object_storage_status,
        store_document_file,
        load_document_file,
        delete_document_file,
        vault_root,
    )

    status = object_storage_status()
    backend = active_storage_backend()
    print("STATUS", status["backend"], status["note"][:90])
    assert backend in {"local", "s3"}

    # Always verify local encrypt path works even when S3 is not configured
    if not is_s3_configured() or backend == "local":
        stored = store_document_file(
            family_id="smoke-family",
            item_id="smoke-item",
            filename="vault-smoke.txt",
            content_type="text/plain",
            data=b"s4-vault-smoke-bytes",
        )
        assert stored["file_encrypted"] is True
        assert not str(stored["file_path"]).startswith("s3:")
        data = load_document_file(stored["file_path"], expected_sha256=stored["file_sha256"])
        assert data == b"s4-vault-smoke-bytes"
        delete_document_file(stored["file_path"])
        print("PASS local_encrypted_roundtrip", vault_root())

    access = None
    for email, password in ACCOUNTS:
        try:
            login = http_json("POST", "/auth/login", body={"email": email, "password": password})
            access = login.get("access_token")
            if access:
                print("PASS login", email)
                break
        except HTTPError:
            continue
    if not access:
        raise RuntimeError("No known smoke account could login")
    api_status = http_json("GET", "/phase16/vault-status", token=access)
    assert "backend" in api_status
    print("PASS api_vault_status", api_status.get("backend"), api_status.get("s3_configured"))

    if is_s3_configured() and backend == "s3":
        ensure = http_json("POST", "/phase16/vault-ensure-bucket", token=access, body={})
        print("ENSURE", ensure.get("ok"), ensure.get("created"), ensure.get("reason", ""))
        if ensure.get("ok"):
            stored = store_document_file(
                family_id="smoke-family",
                item_id="smoke-s3-item",
                filename="vault-s3-smoke.txt",
                content_type="text/plain",
                data=b"s4-s3-vault-smoke",
            )
            assert str(stored["file_path"]).startswith("s3:")
            data = load_document_file(stored["file_path"], expected_sha256=stored["file_sha256"])
            assert data == b"s4-s3-vault-smoke"
            delete_document_file(stored["file_path"])
            print("PASS s3_encrypted_roundtrip", stored["file_path"])
        else:
            print("SKIP s3_roundtrip", ensure.get("reason"))
    else:
        print("SKIP s3_roundtrip (S3 not configured — local vault active)")

    print("PASS object_storage_smoke")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as exc:
        print("HTTP FAIL", exc.code, exc.read().decode("utf-8", errors="ignore"))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        sys.exit(1)
