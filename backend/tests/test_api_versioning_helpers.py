"""Unit tests for API version helpers."""

from __future__ import annotations

from app.core.api_versioning import api_version_payload, resolve_api_version


def test_resolve_api_version_paths():
    assert resolve_api_version("/api/v1/health") == "1"
    assert resolve_api_version("/api/v1") == "1"
    assert resolve_api_version("/api/v2/auth/login") == "2"
    assert resolve_api_version("/api/v2") == "2"
    assert resolve_api_version("/health") is None
    assert resolve_api_version("/auth/login") is None


def test_api_version_payload_shape():
    payload = api_version_payload("2")
    assert payload["api_version"] == "2"
    assert payload["supported_versions"] == ["1", "2"]
    assert payload["prefixes"]["v1"] == "/api/v1"
    assert payload["prefixes"]["v2"] == "/api/v2"
    assert "prefer /api/v2" in payload["note"].lower() or "v2" in payload["note"]
