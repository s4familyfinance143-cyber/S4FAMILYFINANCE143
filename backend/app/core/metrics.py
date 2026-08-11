"""Prometheus metrics for FastAPI + SQLAlchemy pool gauges (no instrumentator)."""

from __future__ import annotations

import time

from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import REGISTRY
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match

from app.core.config import settings
from app.core.database import engine


_SKIP_PATHS = {
    "/metrics",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "handler", "status"],
)
HTTP_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "handler"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
HTTP_INPROGRESS = Gauge(
    "http_requests_inprogress",
    "HTTP requests in progress",
    ["method"],
)


class _SqlAlchemyPoolCollector:
    """Expose DB connection pool usage for Grafana / alerts (DB conn > 90%)."""

    def collect(self):
        if settings.IS_SQLITE:
            return

        pool = engine.pool
        checked_out = float(pool.checkedout())
        pool_size = float(pool.size())
        overflow = float(pool.overflow())
        max_overflow = float(getattr(settings, "DB_MAX_OVERFLOW", 0) or 0)
        capacity = pool_size + max_overflow
        utilization = (checked_out / capacity) if capacity > 0 else 0.0

        checked = GaugeMetricFamily(
            "s4_db_pool_checked_out",
            "SQLAlchemy connections currently checked out",
        )
        checked.add_metric([], checked_out)
        yield checked

        size_m = GaugeMetricFamily(
            "s4_db_pool_size",
            "SQLAlchemy configured pool_size",
        )
        size_m.add_metric([], pool_size)
        yield size_m

        overflow_m = GaugeMetricFamily(
            "s4_db_pool_overflow",
            "SQLAlchemy overflow connections in use",
        )
        overflow_m.add_metric([], overflow)
        yield overflow_m

        util_m = GaugeMetricFamily(
            "s4_db_pool_utilization_ratio",
            "Checked-out / (pool_size + max_overflow)",
        )
        util_m.add_metric([], utilization)
        yield util_m


class _OpsCollector:
    """Export stuck jobs + recent sync failure rate for warning alerts."""

    def collect(self):
        stuck = 0.0
        sync_fail_rate = 0.0
        try:
            from datetime import timedelta

            from sqlalchemy import func

            from app.core.database import SessionLocal
            from app.core.timeutil import utc_now
            from app.models.architecture_system import SyncLog
            from app.models.infra_jobs import ExportJob

            db = SessionLocal()
            try:
                cutoff = utc_now() - timedelta(minutes=10)
                stuck = float(
                    db.query(func.count(ExportJob.id))
                    .filter(
                        ExportJob.status.in_(("PENDING", "RUNNING", "PROCESSING")),
                        ExportJob.created_at < cutoff,
                        ExportJob.deleted_at.is_(None),
                    )
                    .scalar()
                    or 0
                )
                window = utc_now() - timedelta(hours=1)
                total = (
                    db.query(func.count(SyncLog.id))
                    .filter(SyncLog.synced_at >= window, SyncLog.deleted_at.is_(None))
                    .scalar()
                    or 0
                )
                if total:
                    fails = (
                        db.query(func.count(SyncLog.id))
                        .filter(
                            SyncLog.synced_at >= window,
                            SyncLog.deleted_at.is_(None),
                            SyncLog.success.is_(False),
                        )
                        .scalar()
                        or 0
                    )
                    sync_fail_rate = float(fails) / float(total)
            finally:
                db.close()
        except Exception:
            stuck = 0.0
            sync_fail_rate = 0.0

        stuck_m = GaugeMetricFamily(
            "s4_export_jobs_stuck",
            "Export jobs PENDING/RUNNING older than 10 minutes",
        )
        stuck_m.add_metric([], stuck)
        yield stuck_m

        sync_m = GaugeMetricFamily(
            "s4_sync_failure_rate",
            "SyncLog failure ratio over the last hour",
        )
        sync_m.add_metric([], sync_fail_rate)
        yield sync_m


_pool_collector_registered = False


def _handler_label(request: Request) -> str:
    path = request.url.path or "unknown"
    if path in _SKIP_PATHS:
        return path
    for route in request.app.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return getattr(route, "path", path) or path
    return path


async def _metrics_endpoint(_request: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


class PrometheusMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path") or ""
        method = scope.get("method") or "GET"
        if path in _SKIP_PATHS or path.startswith("/docs") or path.startswith("/redoc"):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        handler = _handler_label(request)
        HTTP_INPROGRESS.labels(method=method).inc()
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - started
            HTTP_INPROGRESS.labels(method=method).dec()
            HTTP_DURATION.labels(method=method, handler=handler).observe(elapsed)
            HTTP_REQUESTS.labels(
                method=method,
                handler=handler,
                status=str(status_code),
            ).inc()


def setup_metrics(app) -> None:
    """Instrument HTTP metrics and expose GET /metrics (Prometheus text format)."""
    global _pool_collector_registered

    if not _pool_collector_registered:
        REGISTRY.register(_SqlAlchemyPoolCollector())
        REGISTRY.register(_OpsCollector())
        _pool_collector_registered = True

    app.add_middleware(PrometheusMiddleware)
    app.add_route("/metrics", _metrics_endpoint, methods=["GET"], include_in_schema=False)
