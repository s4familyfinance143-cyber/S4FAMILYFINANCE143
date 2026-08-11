"""Rate limit middleware alias — SlowAPI is the production rate limiter.

Architecture `rate_limits` table is mirrored from auth POSTs in RequestLoggerMiddleware /
architecture_system_hooks.bump_rate_limit (see request_logger).
"""

from slowapi.middleware import SlowAPIMiddleware

# Checklist name mapping: RateLimitMiddleware == SlowAPIMiddleware
RateLimitMiddleware = SlowAPIMiddleware

__all__ = ["RateLimitMiddleware", "SlowAPIMiddleware"]
