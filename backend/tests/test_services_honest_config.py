"""Honest config services — no fake success when secrets missing."""

from __future__ import annotations

from app.core import config as config_module
from app.services import document_vault_service, email_service, fcm_service


def test_smtp_not_configured_is_honest(monkeypatch):
    monkeypatch.setattr(config_module.settings, "SMTP_HOST", None)
    monkeypatch.setattr(config_module.settings, "SMTP_FROM_EMAIL", None)
    assert email_service.is_smtp_configured() is False
    result = email_service.send_email(to_email="a@b.com", subject="t", text_body="x")
    assert result.sent is False
    assert "SMTP not configured" in result.reason


def test_fcm_not_configured_is_honest(monkeypatch):
    status = fcm_service.fcm_status()
    assert status["configured"] is False
    assert status["firebase_admin_available"] is False
    result = fcm_service.send_fcm_push(token="tok", title="t", body="b")
    assert result.sent is False
    assert "removed" in result.reason.lower() or "fcm" in result.reason.lower()


def test_s3_not_configured_falls_back_local(monkeypatch):
    monkeypatch.setattr(config_module.settings, "S3_ENDPOINT_URL", None)
    monkeypatch.setattr(config_module.settings, "S3_BUCKET", None)
    monkeypatch.setattr(config_module.settings, "S3_ACCESS_KEY", None)
    monkeypatch.setattr(config_module.settings, "S3_SECRET_KEY", None)
    monkeypatch.setattr(config_module.settings, "DOCUMENT_VAULT_BACKEND", "auto")
    status = document_vault_service.object_storage_status()
    assert status["backend"] == "local"
    assert status["s3_configured"] is False
    assert document_vault_service.active_storage_backend() == "local"


def test_local_vault_encrypt_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_VAULT_ROOT", str(tmp_path))
    monkeypatch.setattr(config_module.settings, "S3_ENDPOINT_URL", None)
    monkeypatch.setattr(config_module.settings, "S3_BUCKET", None)
    monkeypatch.setattr(config_module.settings, "S3_ACCESS_KEY", None)
    monkeypatch.setattr(config_module.settings, "S3_SECRET_KEY", None)
    monkeypatch.setattr(config_module.settings, "DOCUMENT_VAULT_BACKEND", "local")

    stored = document_vault_service.store_document_file(
        family_id="fam",
        item_id="item",
        filename="note.txt",
        content_type="text/plain",
        data=b"hello-vault",
    )
    assert stored["file_encrypted"] is True
    assert not stored["file_path"].startswith("s3:")
    data = document_vault_service.load_document_file(stored["file_path"], expected_sha256=stored["file_sha256"])
    assert data == b"hello-vault"
    document_vault_service.delete_document_file(stored["file_path"])
