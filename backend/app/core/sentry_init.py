"""Optional Sentry SDK bootstrap (no-op when SENTRY_DSN is unset)."""

from __future__ import annotations

import os


def init_sentry() -> None:
    from app.core.config import settings

    dsn = settings.SENTRY_DSN
    if not dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.SENTRY_ENVIRONMENT or settings.ENVIRONMENT,
        release=os.getenv("SENTRY_RELEASE"),
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        integrations=[FastApiIntegration(), CeleryIntegration()],
    )
