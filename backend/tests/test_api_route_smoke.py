"""Broad API registration smoke tests plus small pure-service coverage."""

from __future__ import annotations

import hashlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core import metrics
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.services import document_vault_service as vault
from app.services import ocr_service


client = TestClient(app)
PASSWORD = "RouteSmoke9!"


@pytest.fixture(scope="module")
def authenticated_family() -> tuple[dict[str, str], str]:
    email = f"route-smoke-{uuid4().hex[:10]}@s4family.com"
    db = SessionLocal()
    try:
        db.add(
            User(
                full_name="Route Smoke Owner",
                email=email,
                password_hash=hash_password(PASSWORD),
                preferred_language="bn",
                is_active=True,
                is_email_verified=True,
            )
        )
        db.commit()
    finally:
        db.close()

    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    created = client.post(
        "/api/v1/families",
        headers=headers,
        json={
            "name": f"Smoke Family {uuid4().hex[:6]}",
            "relationship_type": "Husband",
            "default_currency": "BDT",
            "timezone": "Asia/Dhaka",
        },
    )
    assert created.status_code in {200, 201}, created.text
    body = created.json()
    family_id = body.get("family_id") or body.get("id") or (body.get("family") or {}).get("id")
    assert family_id
    return headers, family_id


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/me",
        "/api/v1/families",
        "/api/v1/categories/family/family-id",
        "/api/v1/budgets/family-id",
        "/api/v1/loans/family-id",
        "/api/v1/grocery/lists/family-id",
        "/api/v1/reports/dashboard/family-id",
        "/api/v1/zakat/family-id",
        "/api/v1/accounts/family/family-id",
        "/api/v1/goals/family-id",
        "/api/v1/savings/family-id",
        "/api/v1/notifications/family-id",
    ],
)
def test_protected_get_routes_reject_anonymous_requests(path: str):
    response = client.get(path)
    assert response.status_code in {401, 403}, (path, response.status_code, response.text)


@pytest.mark.parametrize("path", ["/api/v1/health", "/health"])
def test_health_routes(path: str):
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_metrics_route():
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "http_requests_total" in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"full_name": "A", "email": "not-an-email", "password": "short"},
        {"full_name": "Valid Name", "email": "valid@example.com", "password": "password"},
    ],
)
def test_register_validation_rejects_invalid_payloads(payload: dict):
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/categories/family/{family_id}",
        "/api/v1/budgets/{family_id}",
        "/api/v1/loans/{family_id}",
        "/api/v1/grocery/lists/{family_id}",
    ],
)
def test_authenticated_list_routes(
    authenticated_family: tuple[dict[str, str], str], path: str
):
    headers, family_id = authenticated_family
    response = client.get(path.format(family_id=family_id), headers=headers)
    assert response.status_code == 200, (path, response.text)
    assert isinstance(response.json(), list)


def test_authenticated_zakat_calculation(
    authenticated_family: tuple[dict[str, str], str],
):
    headers, family_id = authenticated_family
    response = client.post(
        "/api/v1/zakat/calculate",
        headers=headers,
        json={
            "family_id": family_id,
            "calculation_year": "1448",
            "currency": "BDT",
            "cash_amount": "100000",
            "deductible_debts": "10000",
            "nisab_amount": "50000",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["family_id"] == family_id
    assert body["zakat_due"] == "2250.0000"


def test_authenticated_report_dashboard(
    authenticated_family: tuple[dict[str, str], str],
):
    headers, family_id = authenticated_family
    response = client.get(f"/api/v1/reports/dashboard/{family_id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["family_id"] == family_id


def test_local_document_vault_round_trip_and_delete(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_VAULT_ROOT", str(tmp_path))
    monkeypatch.setattr(vault.settings, "DOCUMENT_VAULT_BACKEND", "local")
    data = b"private family document"

    stored = vault.store_document_file(
        family_id="family-1",
        item_id="item-1",
        filename="statement.txt",
        content_type="text/plain",
        data=data,
    )

    assert stored["storage_backend"] == "local"
    assert stored["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert vault.load_document_file(stored["file_path"], stored["file_sha256"]) == data

    with pytest.raises(ValueError, match="integrity"):
        vault.load_document_file(stored["file_path"], "0" * 64)

    vault.delete_document_file(stored["file_path"])
    with pytest.raises(FileNotFoundError):
        vault.load_document_file(stored["file_path"])
    vault.delete_document_file(None)


@pytest.mark.parametrize(
    ("filename", "content_type", "size", "message"),
    [
        ("empty.txt", "text/plain", 0, "Empty"),
        ("huge.pdf", "application/pdf", vault.MAX_DOCUMENT_BYTES + 1, "too large"),
        ("script.exe", "application/octet-stream", 1, "Unsupported"),
        ("../escape.txt", "text/plain", 1, "Invalid filename"),
    ],
)
def test_document_vault_upload_validation(filename, content_type, size, message):
    with pytest.raises(ValueError, match=message):
        vault.validate_upload(filename, content_type, size)


def test_document_vault_local_status_and_presigned_guards(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_VAULT_ROOT", str(tmp_path))
    monkeypatch.setattr(vault.settings, "DOCUMENT_VAULT_BACKEND", "local")
    monkeypatch.setattr(vault.settings, "S3_ENDPOINT_URL", "")
    monkeypatch.setattr(vault.settings, "S3_BUCKET", "")
    monkeypatch.setattr(vault.settings, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(vault.settings, "S3_SECRET_KEY", "")

    status = vault.object_storage_status()
    assert status["backend"] == "local"
    assert status["s3_configured"] is False
    assert vault.ensure_s3_bucket()["ok"] is False
    assert vault.generate_presigned_get_url("family/file.bin") is None
    assert vault.generate_presigned_put_url(family_id="family", filename="file.txt") is None


def test_metrics_helpers_label_routes_and_collectors():
    scope = {
        "type": "http",
        "method": "GET",
        "scheme": "http",
        "path": "/api/v1/health",
        "raw_path": b"/api/v1/health",
        "query_string": b"",
        "headers": [],
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "app": app,
    }
    request = Request(scope)
    assert metrics._handler_label(request) == "/api/v1/health"

    scope["path"] = "/metrics"
    scope["raw_path"] = b"/metrics"
    assert metrics._handler_label(Request(scope)) == "/metrics"
    assert list(metrics._SqlAlchemyPoolCollector().collect()) == []
    assert len(list(metrics._OpsCollector().collect())) == 2


def test_ocr_text_parsers_cover_prices_totals_and_empty_input(monkeypatch):
    monkeypatch.setattr(ocr_service, "_tesseract_available", lambda: False)
    suggestions = ocr_service.parse_receipt_lines(
        "Rice 1,250.50\nMilk Tk 90\nUnpriced item\n\n"
    )
    assert [row["estimated_price"] for row in suggestions] == [
        "1250.5000",
        "90.0000",
        "0.0000",
    ]

    grocery = ocr_service.grocery_ocr_parse(raw_text="Rice 100\nEggs ৳50")
    assert grocery["engine"] == "text_parse"
    assert grocery["suggestion_count"] == 2

    expense = ocr_service.expense_bill_ocr_parse(raw_text="Rice 100\nEggs 50.25")
    assert expense["module"] == "EXPENSE"
    assert expense["line_count"] == 2
    assert expense["suggested_total"] == "150.2500"

    empty = ocr_service.grocery_ocr_parse()
    assert empty["suggestions"] == []
    assert empty["note"]
