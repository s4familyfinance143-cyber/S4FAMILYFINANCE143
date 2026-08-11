from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

MONEY_SCALE = Decimal("0.0001")


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def to_decimal(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")
