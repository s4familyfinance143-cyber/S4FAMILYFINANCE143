from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.timeutil import utc_now
from app.models.account import Account
from app.models.architecture_feature import LoanPayment
from app.models.family_member import FamilyMember
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.loan import (
    LoanCloseRequest,
    LoanCreateRequest,
    LoanPaymentRequest,
    LoanScheduleGenerateRequest,
    LoanUpdateRequest,
)
from app.services import accounting_service
from app.services.audit_service import write_audit_log
from app.services.loan_schedule_service import (
    apply_payment_to_schedule,
    calc_total_interest,
    installment_response,
    list_installments,
    replace_loan_schedule,
)
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/loans", tags=["Loans"])

MONEY_SCALE = Decimal("0.0001")


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def validate_amount(value) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise HTTPException(400, "Invalid amount")

    if amount <= Decimal("0"):
        raise HTTPException(400, "Amount must be greater than zero")

    return amount


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def clean_currency(value: str | None) -> str:
    currency = (value or "BDT").strip().upper()
    if len(currency) < 3 or len(currency) > 10:
        raise HTTPException(400, "Invalid currency")
    return currency


def can_use_wallet(member: FamilyMember, wallet: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role in {"MEMBER", "SPOUSE"}:
        return (
            wallet.owner_member_id == member.id
            or wallet.is_shared_family is True
            or wallet.is_owner_wallet is True
        )

    return wallet.owner_member_id == member.id or wallet.is_shared_family is True


def get_wallet(db: Session, family_id: str, wallet_id: str, member: FamilyMember) -> Account:
    wallet = (
        db.query(Account)
        .filter(
            Account.id == wallet_id,
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )

    if not wallet:
        raise HTTPException(404, "Wallet not found")

    if not wallet.is_active:
        raise HTTPException(400, "Wallet inactive")

    if not can_use_wallet(member, wallet):
        raise HTTPException(403, "You do not have permission to use this wallet")

    return wallet


def get_loan(db: Session, family_id: str, loan_id: str, lock: bool = True) -> Loan:
    query = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    )

    if lock:
        query = query.with_for_update()

    loan = query.first()

    if not loan:
        raise HTTPException(404, "Loan not found")

    return loan


def require_active_loan(loan: Loan):
    if loan.status != "ACTIVE":
        raise HTTPException(400, "Loan is not active")


def loan_response(loan: Loan, wallet_balance: Decimal | None = None):
    interest_total = calc_total_interest(
        Decimal(loan.principal_amount or 0),
        Decimal(loan.interest_rate or 0),
        int(loan.installment_count or 0),
        loan.interest_type or "NONE",
    )
    data = {
        "id": loan.id,
        "family_id": loan.family_id,
        "owner_member_id": loan.owner_member_id,
        "wallet_account_id": loan.wallet_account_id,
        "loan_type": loan.loan_type,
        "person_name": loan.person_name,
        "principal_amount": money(loan.principal_amount),
        "paid_amount": money(loan.paid_amount),
        "remaining_amount": money(loan.remaining_amount),
        "interest_rate": money(loan.interest_rate),
        "interest_type": loan.interest_type or "NONE",
        "interest_total": money(interest_total),
        "installment_count": loan.installment_count,
        "installment_amount": money(loan.installment_amount) if loan.installment_amount is not None else None,
        "start_date": loan.start_date,
        "next_due_date": loan.next_due_date,
        "end_date": loan.end_date,
        "currency": loan.currency,
        "status": loan.status,
        "note": loan.note,
        "created_at": loan.created_at,
    }

    if wallet_balance is not None:
        data["wallet_balance"] = money(wallet_balance)

    return data


def duplicate_recent_payment(
    db: Session,
    family_id: str,
    loan_id: str,
    amount: Decimal,
    currency: str,
    description: str | None,
):
    since = utc_now() - timedelta(seconds=10)

    return (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.loan_id == loan_id,
            Transaction.amount == amount,
            Transaction.currency == currency,
            Transaction.description == description,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
            Transaction.created_at >= since,
        )
        .first()
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_loan(
    payload: LoanCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="loan.create",
    )

    amount = validate_amount(payload.principal_amount)
    currency = clean_currency(payload.currency)
    loan_type = payload.loan_type.upper().strip()
    person_name = payload.person_name.strip()
    note = clean_text(payload.note)

    if loan_type not in {"GIVEN", "TAKEN"}:
        raise HTTPException(400, "loan_type must be GIVEN or TAKEN")

    if not person_name:
        raise HTTPException(400, "Person name required")

    wallet = get_wallet(db, payload.family_id, payload.wallet_account_id, member)

    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    wallet_balance = Decimal(wallet.current_balance or 0)

    if loan_type == "GIVEN" and wallet_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(wallet_balance)}, Requested={money(amount)}",
        )

    interest_rate = Decimal(payload.interest_rate or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    interest_type = (payload.interest_type or "NONE").upper().strip()
    installment_count = payload.installment_count
    start_date = clean_text(payload.start_date) or date.today().isoformat()

    loan = Loan(
        family_id=payload.family_id,
        owner_member_id=member.id,
        wallet_account_id=wallet.id,
        loan_type=loan_type,
        person_name=person_name,
        principal_amount=amount,
        paid_amount=Decimal("0"),
        remaining_amount=amount,
        interest_rate=interest_rate,
        interest_type=interest_type,
        installment_count=installment_count,
        start_date=start_date,
        currency=currency,
        status="ACTIVE",
        note=note,
    )

    db.add(loan)
    db.flush()

    if installment_count:
        replace_loan_schedule(db, loan)

    if loan_type == "GIVEN":
        tx = accounting_service.post_loan_given(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            wallet=wallet,
            amount=amount,
            currency=currency,
            loan_id=loan.id,
            description=note,
        )
        audit_title = "Loan Given Created"
        audit_description = f"Given loan {money(amount)} {currency} to {person_name} from {wallet.name}"
    else:
        tx = accounting_service.post_loan_taken(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            wallet=wallet,
            amount=amount,
            currency=currency,
            loan_id=loan.id,
            description=note,
        )
        audit_title = "Loan Taken Created"
        audit_description = f"Taken loan {money(amount)} {currency} from {person_name} into {wallet.name}"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type=f"LOAN_{loan_type}",
        entity_id=loan.id,
        title=audit_title,
        description=audit_description,
    )

    db.commit()
    db.refresh(loan)
    db.refresh(wallet)

    return loan_response(loan, wallet.current_balance)


@router.get("/{family_id}")
def list_loans(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="loan.read",
    )

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .order_by(Loan.created_at.desc())
        .all()
    )

    return [loan_response(loan) for loan in loans]


@router.post("/payment", status_code=status.HTTP_201_CREATED)
def loan_payment(
    payload: LoanPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="loan.payment",
    )

    amount = validate_amount(payload.amount)
    currency = clean_currency(payload.currency)
    description = clean_text(payload.description)

    loan = get_loan(db, payload.family_id, payload.loan_id)
    require_active_loan(loan)

    wallet = get_wallet(db, payload.family_id, payload.wallet_account_id, member)

    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    if loan.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Loan currency is {loan.currency}")

    if amount > Decimal(loan.remaining_amount or 0):
        raise HTTPException(400, "Payment cannot exceed remaining loan amount")

    wallet_balance = Decimal(wallet.current_balance or 0)

    if loan.loan_type == "TAKEN" and wallet_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(wallet_balance)}, Requested={money(amount)}",
        )

    duplicate = duplicate_recent_payment(
        db=db,
        family_id=payload.family_id,
        loan_id=loan.id,
        amount=amount,
        currency=currency,
        description=description,
    )

    if duplicate:
        raise HTTPException(409, "Duplicate loan payment blocked. Please refresh before posting again.")

    tx = accounting_service.post_loan_installment(
        db,
        family_id=payload.family_id,
        member_id=member.id,
        wallet=wallet,
        amount=amount,
        currency=currency,
        loan_type=loan.loan_type,
        loan_id=loan.id,
        description=description,
    )

    if loan.loan_type == "GIVEN":
        audit_title = "Loan Repayment Received"
        audit_description = f"Received {money(amount)} {currency} repayment from {loan.person_name} into {wallet.name}"
    else:
        audit_title = "Loan Payment Made"
        audit_description = f"Paid {money(amount)} {currency} loan payment to {loan.person_name} from {wallet.name}"

    loan.paid_amount = Decimal(loan.paid_amount or 0) + amount
    loan.remaining_amount = Decimal(loan.remaining_amount or 0) - amount

    if loan.remaining_amount == Decimal("0.0000"):
        loan.status = "CLOSED"

    apply_payment_to_schedule(
        db,
        family_id=payload.family_id,
        loan_id=loan.id,
        amount=amount,
        paid_at=date.today().isoformat(),
    )

    db.add(
        LoanPayment(
            loan_id=loan.id,
            family_id=payload.family_id,
            amount=amount,
            payment_date=date.today().isoformat(),
            notes=description,
            transaction_id=tx.id,
        )
    )

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="PAYMENT",
        entity_type=f"LOAN_{loan.loan_type}",
        entity_id=loan.id,
        title=audit_title,
        description=audit_description,
    )

    db.commit()
    db.refresh(loan)

    return {
        "success": True,
        "transaction_id": tx.id,
        "loan_id": loan.id,
        "paid_amount": money(loan.paid_amount),
        "remaining_amount": money(loan.remaining_amount),
        "wallet_balance": money(wallet.current_balance),
        "status": loan.status,
    }

@router.patch("/{loan_id}")
def update_loan(
    loan_id: str,
    payload: LoanUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="loan.create",
    )

    loan = get_loan(db, payload.family_id, loan_id)

    if loan.status != "ACTIVE":
        raise HTTPException(400, "Only active loan can be edited")

    person_name = payload.person_name.strip()

    if not person_name:
        raise HTTPException(400, "Person name required")

    loan.person_name = person_name
    loan.note = clean_text(payload.note)

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type=f"LOAN_{loan.loan_type}",
        entity_id=loan.id,
        title="Loan Updated",
        description=f"Loan updated for {loan.person_name}",
    )

    db.commit()
    db.refresh(loan)

    return loan_response(loan)


@router.get("/{loan_id}/history/{family_id}")
def loan_history(
    loan_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="loan.read",
    )

    loan = get_loan(db, family_id, loan_id, lock=False)

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.loan_id == loan.id,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.created_at.desc())
        .all()
    )

    return {
        "loan": loan_response(loan),
        "history": [
            {
                "id": tx.id,
                "transaction_type": tx.transaction_type,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "description": tx.description,
                "created_at": tx.created_at,
                "status": tx.status,
            }
            for tx in transactions
        ],
    }


@router.post("/{loan_id}/close")
def close_loan(
    loan_id: str,
    payload: LoanCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="loan.create",
    )

    loan = get_loan(db, payload.family_id, loan_id)

    if loan.status == "CLOSED":
        raise HTTPException(400, "Loan already closed")

    if Decimal(loan.remaining_amount or 0) > Decimal("0"):
        raise HTTPException(400, "Loan has remaining balance. Pay full amount before closing.")

    loan.status = "CLOSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type=f"LOAN_{loan.loan_type}",
        entity_id=loan.id,
        title="Loan Closed",
        description=clean_text(payload.reason) or f"Loan with {loan.person_name} closed",
    )

    db.commit()
    db.refresh(loan)

    return loan_response(loan)


@router.get("/{loan_id}/schedule")
def get_loan_schedule(
    loan_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db=db, family_id=family_id, user_id=current_user.id, permission="loan.read")
    loan = get_loan(db, family_id, loan_id, lock=False)
    rows = list(list_installments(db, family_id, loan.id))
    return {
        "loan": loan_response(loan),
        "installments": [installment_response(r) for r in rows],
        "count": len(rows),
    }


@router.post("/{loan_id}/schedule/generate")
def generate_loan_schedule(
    loan_id: str,
    payload: LoanScheduleGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="loan.create",
    )
    loan = get_loan(db, payload.family_id, loan_id)
    require_active_loan(loan)

    if payload.installment_count is not None:
        loan.installment_count = payload.installment_count
    if payload.interest_rate is not None:
        loan.interest_rate = Decimal(payload.interest_rate).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    if payload.interest_type:
        loan.interest_type = payload.interest_type.upper().strip()
    if payload.start_date:
        loan.start_date = clean_text(payload.start_date)

    if not loan.installment_count:
        raise HTTPException(400, "installment_count required to generate schedule")

    rows = replace_loan_schedule(db, loan)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="GENERATE",
        entity_type="LOAN_SCHEDULE",
        entity_id=loan.id,
        title="Loan schedule generated",
        description=f"{len(rows)} installments",
    )
    db.commit()
    db.refresh(loan)
    return {
        "loan": loan_response(loan),
        "installments": [installment_response(r) for r in rows],
        "count": len(rows),
    }