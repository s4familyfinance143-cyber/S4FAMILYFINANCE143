"""Smoke helpers for Google Drive vault (no network if not configured)."""

from app.services.document_vault_service import active_storage_backend, object_storage_status, store_document_file, load_document_file, delete_document_file


def smoke_gdrive_roundtrip() -> dict:
    status = object_storage_status()
    if status.get("backend") != "gdrive":
        return {"ok": False, "reason": f"backend is {status.get('backend')}, not gdrive", **status}
    if not status.get("gdrive_configured"):
        return {"ok": False, "reason": "gdrive not configured", **status}

    data = b"%PDF-1.4 smoke-test-s4-family\n"
    meta = store_document_file(
        family_id="smoke_family",
        item_id="smoke_item",
        filename="smoke.txt",
        content_type="text/plain",
        data=data,
    )
    loaded = load_document_file(meta["file_path"], expected_sha256=meta["file_sha256"])
    delete_document_file(meta["file_path"])
    return {
        "ok": loaded == data,
        "file_path": meta["file_path"],
        "storage_backend": meta["storage_backend"],
        "backend": active_storage_backend(),
    }
