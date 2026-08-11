from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.sentry_init import init_sentry
from app.core.database import engine
from app.core.errors import register_exception_handlers
from app.core.metrics import setup_metrics
from app.core.rate_limit import limiter
from app.middleware.audit_middleware import AuditLogMiddleware
from app.middleware.auth_middleware import AuthContextMiddleware
from app.middleware.global_error_handler import GlobalErrorHandler
from app.middleware.rate_limit_middleware import RateLimitMiddleware
from app.middleware.request_logger import RequestLoggerMiddleware
from app.middleware.response_formatter import ResponseFormatterMiddleware
from app.models.base import Base
import app.models as _all_models  # noqa: F401 — register all ORM tables
from app.workers.auto_backup_worker import process_auto_backup
from app.workers.recurring_scheduler import process_recurring_transactions
from app.api.v1.family_governance_hardened import router as family_governance_hardened_router


init_sentry()


def create_development_tables() -> None:
    """
    Development safety:
    - SQLite local dev can auto-create tables.
    - Production PostgreSQL must use Alembic migrations, not create_all.
    - Deprecated alias tables (auth_sessions, push_devices) must not be recreated.
    """
    if settings.AUTO_CREATE_TABLES and settings.IS_SQLITE:
        for deprecated in ("auth_sessions", "push_devices"):
            table = Base.metadata.tables.get(deprecated)
            if table is not None:
                Base.metadata.remove(table)
        Base.metadata.create_all(bind=engine)
        try:
            from app.services.schema_guard import ensure_sqlite_columns

            added = ensure_sqlite_columns()
            if added:
                print("SQLite schema guard added:", ", ".join(added))
        except Exception as exc:
            print("SQLite schema guard error:", exc)


create_development_tables()

try:
    from app.core.audit_events import register_audit_listeners

    register_audit_listeners(Base)
except Exception as _audit_exc:
    print("Audit event listeners not registered:", _audit_exc)


async def recurring_worker():
    while True:
        try:
            process_recurring_transactions()
        except Exception as e:
            print("Scheduler Worker Error:", str(e))

        await asyncio.sleep(60)


async def auto_backup_worker():
    while True:
        try:
            result = process_auto_backup()
            print("Auto Backup Worker:", result)
        except Exception as e:
            print("Auto Backup Worker Error:", str(e))

        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.grocery_realtime import grocery_realtime_hub

    grocery_realtime_hub.bind_loop(asyncio.get_running_loop())

    # When Celery is enabled, prefer external workers; skip in-process asyncio duplicates.
    use_inprocess = not bool(settings.CELERY_ENABLED)

    if settings.ENABLE_RECURRING_WORKER and use_inprocess:
        asyncio.create_task(recurring_worker())

    if settings.ENABLE_AUTO_BACKUP_WORKER and use_inprocess:
        asyncio.create_task(auto_backup_worker())

    if settings.CELERY_ENABLED:
        try:
            from app.workers.celery_app import celery_app

            # Eager/ping so health can show worker wiring without requiring Redis for import
            _ = celery_app
            print("Celery enabled — run a worker separately (in-process asyncio workers skipped).")
        except Exception as exc:
            print("Celery enabled but failed to import:", exc)

    yield


app = FastAPI(
    title="S4 FAMILY FINANCE API",
    version="1.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
register_exception_handlers(app)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
setup_metrics(app)


@app.middleware("http")
async def mark_unversioned_api_deprecated(request, call_next):
    """Keep legacy mounts working while directing API clients to /api/v1."""
    response = await call_next(request)
    path = request.url.path
    infrastructure_paths = {"/", "/health", "/metrics", "/docs", "/openapi.json", "/redoc"}
    if path not in infrastructure_paths and not path.startswith(("/api/v1", "/api/v2")):
        response.headers["Deprecation"] = "true"
        response.headers["Link"] = '</api/v1>; rel="successor-version"'
    return response

# Middleware order: last added = first executed on request.
# Desired outer→inner: CORS → RequestLogger → Auth → RateLimit → Audit → ResponseFormatter → GlobalError → app
app.add_middleware(GlobalErrorHandler)
app.add_middleware(ResponseFormatterMiddleware)
app.add_middleware(AuditLogMiddleware)
app.add_middleware(RateLimitMiddleware)  # SlowAPI
app.add_middleware(AuthContextMiddleware)
app.add_middleware(RequestLoggerMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(family_governance_hardened_router)
# Compatibility-only unversioned mount: remove after legacy clients have migrated.
app.include_router(api_router)
app.include_router(api_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api/v2")


@app.get("/")
def root():
    return {
        "message": "S4 FAMILY FINANCE API Running",
        "environment": settings.ENVIRONMENT,
        "database": "sqlite" if settings.IS_SQLITE else "postgresql",
    }


@app.get("/health")
@app.get("/api/v1/health")
def health_check():
    from app.models.base import Base
    from app.services.redis_cache import cache_status
    from app.services.redis_session import redis_stack_status

    return {
        "status": "ok",
        "service": "s4-family-finance-api",
        "environment": settings.ENVIRONMENT,
        "database": "sqlite" if settings.IS_SQLITE else "postgresql",
        "api_versions": ["/api/v1", "/api/v2"],
        "cache": cache_status(),
        "redis_stack": redis_stack_status(),
        "orm_table_count": len(Base.metadata.tables),
        "celery_enabled": bool(settings.CELERY_ENABLED),
        "google_vision_enabled": bool(settings.GOOGLE_VISION_ENABLED),
        "metrics_endpoint": "/metrics",
        "layers": {
            "middleware": [
                "CORSMiddleware",
                "RequestLoggerMiddleware",
                "AuthContextMiddleware",
                "RateLimitMiddleware",
                "AuditLogMiddleware",
                "ResponseFormatterMiddleware",
                "GlobalErrorHandler",
            ],
            "auth_middleware": True,
            "request_logger": True,
            "rate_limit": True,
            "audit_middleware": True,
            "response_formatter": True,
            "global_error_handler": True,
            "prometheus_metrics": True,
            "dependency_injection": True,
            "service_layer": True,
            "repository_pattern": True,
            "modules": ["auth", "finance", "grocery"],
            "celery_tasks": [
                "push",
                "email",
                "report",
                "sync_processor",
                "reminders",
                "export",
                "recurring",
                "auto_backup",
            ],
        },
    }


@app.get("/debug/ws-routes")
def debug_ws_routes():
    if settings.IS_PRODUCTION or settings.ENVIRONMENT.lower() in {"staging", "prod"}:
        raise HTTPException(status_code=404, detail="Not found")
    return [
        {"path": getattr(route, "path", None), "type": type(route).__name__}
        for route in app.routes
        if "ws" in str(getattr(route, "path", ""))
    ]


# === PHASE 6B ACCOUNTS / WALLETS ROUTER INCLUDE ===
from app.api.v1.accounts_wallets_hardened import router as accounts_wallets_hardened_router
app.include_router(accounts_wallets_hardened_router)
# === PHASE 6B ACCOUNTS / WALLETS ROUTER INCLUDE END ===


# === PHASE 7B DOUBLE-ENTRY TRANSACTIONS ROUTER INCLUDE ===
from app.api.v1.double_entry_transactions_hardened import router as double_entry_transactions_hardened_router

_phase7b_replace = {
    ("/families/{family_id}/transactions", "GET"),
    ("/families/{family_id}/transactions", "POST"),
    ("/families/{family_id}/transactions/{transaction_id}", "GET"),
}
app.router.routes = [
    r for r in app.router.routes
    if not any((getattr(r, "path", "") == p and m in (getattr(r, "methods", set()) or set())) for p, m in _phase7b_replace)
]
app.include_router(double_entry_transactions_hardened_router)
# === PHASE 7B DOUBLE-ENTRY TRANSACTIONS ROUTER INCLUDE END ===


# === PHASE 8B REPORTS AUDIT INTEGRATION ROUTER INCLUDE ===
from app.api.v1.reports_audit_integration_hardened import router as phase8b_reports_audit_integration_router
app.include_router(phase8b_reports_audit_integration_router)
# === END PHASE 8B REPORTS AUDIT INTEGRATION ROUTER INCLUDE ===

# === PHASE 9B AUDIT TRAIL ROUTER INCLUDE ===
from app.api.v1.audit_trail_hardened import router as phase9b_audit_trail_router
app.include_router(phase9b_audit_trail_router)
# === END PHASE 9B AUDIT TRAIL ROUTER INCLUDE ===

# === PHASE 10B OFFLINE SYNC ROUTER INCLUDE ===
from app.api.v1.offline_sync_hardened import router as phase10b_offline_sync_router
app.include_router(phase10b_offline_sync_router)
# === END PHASE 10B OFFLINE SYNC ROUTER INCLUDE ===
