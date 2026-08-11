"""Smoke test: real encrypted document vault upload + download (no demo seed)."""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API = "http://127.0.0.1:8000"
EMAIL = "test@s4family.com"
PASSWORD = "Test1234!"


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None) -> dict | list:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def multipart_upload(item_id: str, family_id: str, token: str, filename: str, content: bytes, content_type: str) -> dict:
    boundary = f"----S4Boundary{uuid.uuid4().hex}"
    parts = []
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="family_id"\r\n\r\n'
        f"{family_id}\r\n".encode("utf-8")
    )
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
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


def main() -> None:
    try:
        login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    except HTTPError as exc:
        print("LOGIN FAIL", exc.read().decode("utf-8", errors="ignore"))
        raise
    token = login["access_token"]

    families_payload = http_json("GET", "/families", token=token)
    family_list = families_payload if isinstance(families_payload, list) else families_payload.get("families") or []
    assert family_list, "No family"
    family_id = family_list[0]["id"]

    item = http_json(
        "POST",
        "/phase16",
        token=token,
        body={
            "family_id": family_id,
            "module_type": "DOCUMENT",
            "name": "Real Vault Smoke NID",
            "category": "ID",
            "sub_type": "NID",
            "amount": "0",
            "currency": "BDT",
            "renewal_or_expiry_date": "2030-12-31",
            "reference": "SMOKE-REAL",
            "note": "real vault smoke",
        },
    )
    item_id = item["id"]
    assert item["module_type"] == "DOCUMENT"
    assert item.get("has_file") is False

    content = b"%PDF-1.4 real-vault-smoke-content-s4-family\n"
    uploaded = multipart_upload(item_id, family_id, token, "nid_smoke.pdf", content, "application/pdf")
    assert uploaded["has_file"] is True
    assert uploaded["file_name"] == "nid_smoke.pdf"
    assert uploaded["file_encrypted"] is True
    assert uploaded["file_size"] == len(content)
    assert uploaded["file_sha256"]

    req = Request(
        f"{API}/phase16/{item_id}/download?family_id={family_id}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=60) as res:
        downloaded = res.read()
        disposition = res.headers.get("Content-Disposition") or ""
    assert downloaded == content
    assert "nid_smoke.pdf" in disposition

    rows = http_json("GET", f"/phase16/{family_id}?module_type=DOCUMENT", token=token)
    match = next(row for row in rows if row["id"] == item_id)
    assert match["has_file"] is True
    assert match["file_encrypted"] is True

    # Ensure ciphertext on disk is not plaintext
    vault_root = Path(__file__).resolve().parents[1] / "storage" / "document_vault" / family_id
    bins = list(vault_root.glob(f"{item_id}_*.bin")) if vault_root.exists() else []
    assert bins, "Encrypted file missing on disk"
    assert content not in bins[0].read_bytes(), "File stored as plaintext"

    print("PASS document_vault_smoke")
    print(f"  item_id={item_id}")
    print(f"  file_name={uploaded['file_name']}")
    print(f"  encrypted={uploaded['file_encrypted']}")
    print(f"  sha256={uploaded['file_sha256']}")
    print(f"  disk={bins[0].name}")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as exc:
        print("HTTP FAIL", exc.code, exc.read().decode("utf-8", errors="ignore"))
        sys.exit(1)
