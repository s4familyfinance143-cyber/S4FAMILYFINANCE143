from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.currency import Currency, ExchangeRate
from app.models.user import User
from app.schemas.currency import (
    ConvertAmountRequest,
    CurrencyCreate,
    ExchangeRateCreate,
)

router = APIRouter(prefix="/currency", tags=["Currency"])


DEFAULT_CURRENCIES = [
    ("BDT", "Bangladeshi Taka", "৳", 2),
    ("AED", "UAE Dirham", "د.إ", 2),
    ("USD", "US Dollar", "$", 2),
    ("SAR", "Saudi Riyal", "﷼", 2),
    ("INR", "Indian Rupee", "₹", 2),
    ("PKR", "Pakistani Rupee", "₨", 2),
]


def money(value) -> str:
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


@router.post("/seed")
def seed_currencies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    created = 0

    for code, name, symbol, decimal_places in DEFAULT_CURRENCIES:
        exists = (
            db.query(Currency)
            .filter(Currency.code == code)
            .first()
        )

        if exists:
            continue

        db.add(
            Currency(
                code=code,
                name=name,
                symbol=symbol,
                decimal_places=decimal_places,
                is_active=True,
            )
        )
        created += 1

    db.commit()

    return {
        "success": True,
        "created": created,
    }


@router.get("/")
def list_currencies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Currency)
        .filter(Currency.deleted_at.is_(None))
        .order_by(Currency.code.asc())
        .all()
    )

    return [
        {
            "id": item.id,
            "code": item.code,
            "name": item.name,
            "symbol": item.symbol,
            "decimal_places": item.decimal_places,
            "is_active": item.is_active,
        }
        for item in rows
    ]


@router.post("/")
def create_currency(
    payload: CurrencyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    code = payload.code.upper().strip()

    exists = (
        db.query(Currency)
        .filter(Currency.code == code)
        .first()
    )

    if exists:
        raise HTTPException(400, "Currency already exists")

    item = Currency(
        code=code,
        name=payload.name,
        symbol=payload.symbol,
        decimal_places=payload.decimal_places,
        is_active=True,
    )

    db.add(item)
    db.commit()
    db.refresh(item)

    return {
        "id": item.id,
        "code": item.code,
        "name": item.name,
        "symbol": item.symbol,
        "decimal_places": item.decimal_places,
        "is_active": item.is_active,
    }


@router.post("/rates")
def create_exchange_rate(
    payload: ExchangeRateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from_currency = payload.from_currency.upper().strip()
    to_currency = payload.to_currency.upper().strip()

    if from_currency == to_currency:
        raise HTTPException(400, "From and to currency cannot be same")

    exists = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.rate_date == payload.rate_date,
            ExchangeRate.deleted_at.is_(None),
        )
        .first()
    )

    if exists:
        exists.rate = payload.rate
        exists.source = payload.source
        exists.is_active = True
        db.commit()
        db.refresh(exists)
        item = exists
    else:
        item = ExchangeRate(
            from_currency=from_currency,
            to_currency=to_currency,
            rate=payload.rate,
            rate_date=payload.rate_date,
            source=payload.source,
            is_active=True,
        )
        db.add(item)
        db.commit()
        db.refresh(item)

    return {
        "id": item.id,
        "from_currency": item.from_currency,
        "to_currency": item.to_currency,
        "rate": money(item.rate),
        "rate_date": item.rate_date,
        "source": item.source,
    }


@router.get("/rates")
def list_exchange_rates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(ExchangeRate)
        .filter(ExchangeRate.deleted_at.is_(None))
        .order_by(ExchangeRate.rate_date.desc())
        .all()
    )

    return [
        {
            "id": item.id,
            "from_currency": item.from_currency,
            "to_currency": item.to_currency,
            "rate": money(item.rate),
            "rate_date": item.rate_date,
            "source": item.source,
            "is_active": item.is_active,
        }
        for item in rows
    ]


def get_latest_rate(
    db: Session,
    from_currency: str,
    to_currency: str,
    rate_date: date | None = None,
):
    from_currency = from_currency.upper().strip()
    to_currency = to_currency.upper().strip()

    if from_currency == to_currency:
        return Decimal("1")

    query = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.is_active.is_(True),
            ExchangeRate.deleted_at.is_(None),
        )
    )

    if rate_date:
        query = query.filter(ExchangeRate.rate_date <= rate_date)

    item = (
        query.order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if not item:
        raise HTTPException(
            404,
            f"Exchange rate not found: {from_currency} to {to_currency}",
        )

    return Decimal(item.rate)


@router.post("/convert")
def convert_amount(
    payload: ConvertAmountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate = get_latest_rate(
        db=db,
        from_currency=payload.from_currency,
        to_currency=payload.to_currency,
        rate_date=payload.rate_date,
    )

    converted = Decimal(payload.amount) * rate

    return {
        "amount": money(payload.amount),
        "from_currency": payload.from_currency.upper(),
        "to_currency": payload.to_currency.upper(),
        "rate": money(rate),
        "converted_amount": money(converted),
    }
