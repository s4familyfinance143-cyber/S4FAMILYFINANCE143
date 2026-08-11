"""Lightweight metrics / monitoring smoke (no Prometheus server required)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_metrics_endpoint_prometheus_text():
    client.get("/")
    res = client.get("/metrics")
    assert res.status_code == 200
    text = res.text
    assert "http_requests_total" in text
    assert "http_request_duration_seconds" in text


def test_health_exposes_metrics_flag():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("metrics_endpoint") == "/metrics"
    layers = body.get("layers") or {}
    assert layers.get("prometheus_metrics") is True
