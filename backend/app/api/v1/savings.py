from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.family_member import FamilyMember
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.savings import (
    SavingsDepositRequest,
    SavingsGoalCloseRequest,
    SavingsGoalCreateRequest,
    SavingsGoalUpdateRequest,
    SavingsWithdrawRequest,
)
from app.services.audit_service import write_audit_log
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/savings", tags=["Savings"])

MONEY_SCALE = Decimal("0.0001")


def money(value):
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


def percent(current, target):
    current = Decimal(current or 0)
    target = Decimal(target or 0)
    if target <= 0:
        return "0.00"
    return str(((current / target) * Decimal("100")).quantize(Decimal("0.01")))


def get_payload_wallet_id(payload):
    wallet_id = getattr(payload, "wallet_account_id", None)
    if wallet_id:
        return wallet_id

    from_account_id = getattr(payload, "from_account_id", None)
    if from_account_id:
        return from_account_id

    to_account_id = getattr(payload, "to_account_id", None)
    if to_account_id:
        return to_account_id

    raise HTTPException(422, "Wallet account id is required")


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


def get_savings_goal(db: Session, family_id: str, goal_id: str, lock: bool = True) -> SavingsGoal:
    query = db.query(SavingsGoal).filter(
        SavingsGoal.id == goal_id,
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    )

    if lock:
        query = query.with_for_update()

    goal = query.first()

    if not goal:
        raise HTTPException(404, "Savings goal not found")

    return goal


def require_active_goal(goal: SavingsGoal):
    if goal.status != "ACTIVE":
        raise HTTPException(400, "Savings goal is not active")


def savings_response(goal: SavingsGoal):
    return {
        "id": goal.id,
        "family_id": goal.family_id,
        "owner_member_id": goal.owner_member_id,
        "wallet_account_id": goal.wallet_account_id,
        "name": goal.name,
        "goal_type": goal.goal_type,
        "target_amount": money(goal.target_amount),
        "current_amount": money(goal.current_amount),
        "progress_percent": percent(goal.current_amount, goal.target_amount),
        "currency": goal.currency,
        "status": goal.status,
        "note": goal.note,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_savings_goal(
    payload: SavingsGoalCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="savings.create",
    )

    name = payload.name.strip()
    amount = validate_amount(payload.target_amount)
    currency = clean_currency(payload.currency)
    note = clean_text(payload.note)

    wallet = get_wallet(db, payload.family_id, get_payload_wallet_id(payload), member)

    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    goal = SavingsGoal(
        family_id=payload.family_id,
        owner_member_id=member.id,
        wallet_account_id=wallet.id,
        name=name,
        goal_type=(
            "EMERGENCY"
            if (payload.goal_type or "").strip().upper() in {"EMERGENCY", "EMERGENCY_FUND", "EFUND"}
            else (payload.goal_type.strip().upper() or "GENERAL")
        ),
        target_amount=amount,
        current_amount=Decimal("0"),
        currency=currency,
        status="ACTIVE",
        note=note,
    )

    db.add(goal)
    db.flush()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="SAVINGS",
        entity_id=goal.id,
        title="Savings Goal Created",
        description=f"{goal.name} savings goal created with target {money(goal.target_amount)} {goal.currency}",
    )

    db.commit()
    db.refresh(goal)
    return savings_response(goal)


@router.get("/annual-plan/{family_id}")
def savings_annual_plan(
    family_id: str,
    year: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Architecture annual planning for savings/emergency funds."""
    require_permission(db, family_id, current_user.id, "savings.read")
    year = (year or str(date.today().year)).strip()
    goals = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.family_id == family_id, SavingsGoal.deleted_at.is_(None))
        .order_by(SavingsGoal.created_at.desc())
        .all()
    )
    months = Decimal("12")
    plans = []
    total_annual_target = Decimal("0")
    total_saved = Decimal("0")
    emergency_count = 0
    for g in goals:
        target = Decimal(g.target_amount or 0)
        saved = Decimal(g.current_amount or 0)
        monthly = (target / months).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP) if target else Decimal("0")
        gtype = (g.goal_type or "GENERAL").upper()
        if gtype in {"EMERGENCY", "EMERGENCY_FUND"}:
            emergency_count += 1
        total_annual_target += target
        total_saved += saved
        plans.append(
            {
                "id": g.id,
                "name": g.name,
                "goal_type": gtype,
                "year": year,
                "annual_target": money(target),
                "monthly_target": money(monthly),
                "saved_amount": money(saved),
                "remaining": money(max(target - saved, Decimal("0"))),
                "progress_percent": str(
                    ((saved / target) * Decimal("100")).quantize(Decimal("0.01")) if target > 0 else "0.00"
                ),
                "status": g.status,
            }
        )
    return {
        "family_id": family_id,
        "year": year,
        "funds": plans,
        "emergency_fund_count": emergency_count,
        "total_annual_target": money(total_annual_target),
        "total_saved": money(total_saved),
        "total_remaining": money(max(total_annual_target - total_saved, Decimal("0"))),
    }


@router.get("/{family_id}")
def list_savings_goals(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "savings.read")

    goals = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.family_id == family_id, SavingsGoal.deleted_at.is_(None))
        .order_by(SavingsGoal.created_at.desc())
        .all()
    )

    return [savings_response(goal) for goal in goals]


@router.patch("/{goal_id}")
def update_savings_goal(
    goal_id: str,
    payload: SavingsGoalUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "savings.create")
    goal = get_savings_goal(db, payload.family_id, goal_id)
    require_active_goal(goal)

    changes = []

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Savings name required")
        goal.name = name
        changes.append("name")

    if payload.target_amount is not None:
        new_target = validate_amount(payload.target_amount)
        if new_target < Decimal(goal.current_amount or 0):
            raise HTTPException(400, "Target amount cannot be less than current savings amount")
        goal.target_amount = new_target
        changes.append("target_amount")

    if payload.note is not None:
        goal.note = clean_text(payload.note)
        changes.append("note")

    if not changes:
        raise HTTPException(400, "No changes provided")

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="SAVINGS",
        entity_id=goal.id,
        title="Savings Goal Updated",
        description=f"Updated savings goal fields: {', '.join(changes)}",
    )

    db.commit()
    db.refresh(goal)
    return savings_response(goal)


@router.post("/{goal_id}/close")
def close_savings_goal(
    goal_id: str,
    payload: SavingsGoalCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "savings.create")
    goal = get_savings_goal(db, payload.family_id, goal_id)

    if goal.status == "CLOSED":
        raise HTTPException(400, "Savings goal already closed")

    if Decimal(goal.current_amount or 0) > Decimal("0"):
        raise HTTPException(400, "Withdraw savings balance before closing this goal")

    goal.status = "CLOSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type="SAVINGS",
        entity_id=goal.id,
        title="Savings Goal Closed",
        description=clean_text(payload.reason) or f"{goal.name} savings goal closed",
    )

    db.commit()
    db.refresh(goal)
    return savings_response(goal)


@router.get("/{goal_id}/history/{family_id}")
def savings_history(
    goal_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "savings.read")
    goal = get_savings_goal(db, family_id, goal_id, lock=False)

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.goal_id == goal.id,
            Transaction.transaction_type.in_(["SAVINGS_DEPOSIT", "SAVINGS_WITHDRAW"]),
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.created_at.desc())
        .all()
    )

    return {
        "goal": savings_response(goal),
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


@router.post("/deposit", status_code=status.HTTP_201_CREATED)
def deposit_to_savings(
    payload: SavingsDepositRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "savings.deposit")
    amount = validate_amount(payload.amount)
    currency = clean_currency(payload.currency)
    description = clean_text(payload.description)

    goal = get_savings_goal(db, payload.family_id, payload.savings_goal_id)
    require_active_goal(goal)

    wallet = get_wallet(db, payload.family_id, get_payload_wallet_id(payload), member)

    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    if goal.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Savings currency is {goal.currency}")

    wallet_balance = Decimal(wallet.current_balance or 0)

    if wallet_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(wallet_balance)}, Requested={money(amount)}",
        )

    from app.services import accounting_service

    tx = accounting_service.post_savings_deposit(
        db,
        family_id=payload.family_id,
        member_id=member.id,
        wallet=wallet,
        amount=amount,
        currency=currency,
        goal_id=goal.id,
        description=description,
    )
    goal.current_amount = Decimal(goal.current_amount or 0) + amount

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="DEPOSIT",
        entity_type="SAVINGS",
        entity_id=goal.id,
        title="Savings Deposit Posted",
        description=f"Deposited {money(amount)} {currency} to {goal.name} from {wallet.name}",
    )

    db.commit()
    db.refresh(goal)
    db.refresh(wallet)

    return {
        "success": True,
        "transaction_id": tx.id,
        "savings_goal_id": goal.id,
        "current_amount": money(goal.current_amount),
        "target_amount": money(goal.target_amount),
        "progress_percent": percent(goal.current_amount, goal.target_amount),
        "wallet_balance": money(wallet.current_balance),
        "status": goal.status,
    }


@router.post("/withdraw", status_code=status.HTTP_201_CREATED)
def withdraw_from_savings(
    payload: SavingsWithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "savings.withdraw")
    amount = validate_amount(payload.amount)
    currency = clean_currency(payload.currency)
    description = clean_text(payload.description)

    goal = get_savings_goal(db, payload.family_id, payload.savings_goal_id)
    require_active_goal(goal)

    wallet = get_wallet(db, payload.family_id, get_payload_wallet_id(payload), member)

    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    if goal.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Savings currency is {goal.currency}")

    savings_balance = Decimal(goal.current_amount or 0)

    if savings_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient savings balance. Available={money(savings_balance)}, Requested={money(amount)}",
        )

    from app.services import accounting_service

    tx = accounting_service.post_savings_withdraw(
        db,
        family_id=payload.family_id,
        member_id=member.id,
        wallet=wallet,
        amount=amount,
        currency=currency,
        goal_id=goal.id,
        description=description,
    )
    goal.current_amount = savings_balance - amount

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="WITHDRAW",
        entity_type="SAVINGS",
        entity_id=goal.id,
        title="Savings Withdraw Posted",
        description=f"Withdrew {money(amount)} {currency} from {goal.name} to {wallet.name}",
    )

    db.commit()
    db.refresh(goal)

    return {
        "success": True,
        "transaction_id": tx.id,
        "savings_goal_id": goal.id,
        "current_amount": money(goal.current_amount),
        "target_amount": money(goal.target_amount),
        "progress_percent": percent(goal.current_amount, goal.target_amount),
        "wallet_balance": money(wallet.current_balance),
        "status": goal.status,
    }