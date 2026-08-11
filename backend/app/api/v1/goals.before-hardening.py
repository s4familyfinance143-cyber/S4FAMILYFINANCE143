from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.family_member import FamilyMember
from app.models.goal import FinancialGoal
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.goal import (
    GoalContributionRequest,
    GoalCreateRequest,
    GoalWithdrawRequest,
)
from app.services.audit_service import write_audit_log
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/goals", tags=["Financial Goals"])


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def progress_percent(current, target):
    current = Decimal(current or 0)
    target = Decimal(target or 0)

    if target <= 0:
        return "0.00"

    return str(((current / target) * Decimal("100")).quantize(Decimal("0.01")))


def recommended_monthly(goal):
    if not goal.target_date:
        return "0.0000"

    today = date.today()

    months = ((goal.target_date.year - today.year) * 12) + (
        goal.target_date.month - today.month
    )

    if months <= 0:
        months = 1

    remaining = Decimal(goal.target_amount) - Decimal(goal.current_amount)

    if remaining <= 0:
        return "0.0000"

    return money(remaining / Decimal(months))


def get_payload_wallet_id(payload):
    wallet_id = getattr(payload, "wallet_account_id", None)
    if wallet_id:
        return wallet_id

    account_id = getattr(payload, "account_id", None)
    if account_id:
        return account_id

    from_account_id = getattr(payload, "from_account_id", None)
    if from_account_id:
        return from_account_id

    raise HTTPException(422, "Wallet account id is required")


def can_use_wallet(member: FamilyMember, wallet: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role == "SPOUSE":
        return (
            wallet.owner_member_id == member.id
            or wallet.is_shared_family is True
            or wallet.is_owner_wallet is True
        )

    return wallet.owner_member_id == member.id or wallet.is_shared_family is True


def get_wallet(db: Session, family_id: str, wallet_id: str, member: FamilyMember) -> Account:
    wallet = db.get(Account, wallet_id)

    if not wallet or wallet.family_id != family_id or wallet.deleted_at is not None:
        raise HTTPException(404, "Wallet not found")

    if not wallet.is_active:
        raise HTTPException(400, "Wallet inactive")

    if not can_use_wallet(member, wallet):
        raise HTTPException(403, "You do not have permission to use this wallet")

    return wallet


def get_goal(db: Session, family_id: str, goal_id: str) -> FinancialGoal:
    goal = db.get(FinancialGoal, goal_id)

    if not goal or goal.family_id != family_id or goal.deleted_at is not None:
        raise HTTPException(404, "Financial goal not found")

    if goal.status != "ACTIVE":
        raise HTTPException(400, "Financial goal is not active")

    return goal


def get_linked_savings(db: Session, goal: FinancialGoal):
    if not goal.linked_savings_goal_id:
        return None

    savings = db.get(SavingsGoal, goal.linked_savings_goal_id)

    if not savings or savings.family_id != goal.family_id or savings.deleted_at is not None:
        raise HTTPException(400, "Linked savings goal invalid")

    return savings


def serialize_goal(goal: FinancialGoal):
    return {
        "id": goal.id,
        "family_id": goal.family_id,
        "linked_savings_goal_id": goal.linked_savings_goal_id,
        "goal_name": goal.goal_name,
        "goal_type": goal.goal_type,
        "target_amount": money(goal.target_amount),
        "current_amount": money(goal.current_amount),
        "progress_percent": progress_percent(goal.current_amount, goal.target_amount),
        "recommended_monthly_saving": recommended_monthly(goal),
        "currency": goal.currency,
        "target_date": goal.target_date,
        "status": goal.status,
        "note": goal.note,
        "created_at": goal.created_at,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="goal.create",
    )

    linked_savings = None

    if payload.linked_savings_goal_id:
        linked_savings = db.get(SavingsGoal, payload.linked_savings_goal_id)

        if not linked_savings:
            raise HTTPException(404, "Savings goal not found")

        if linked_savings.family_id != payload.family_id:
            raise HTTPException(400, "Savings goal does not belong to this family")

    current_amount = Decimal("0")

    if linked_savings:
        current_amount = linked_savings.current_amount

    goal = FinancialGoal(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        linked_savings_goal_id=payload.linked_savings_goal_id,
        goal_name=payload.goal_name.strip(),
        goal_type=payload.goal_type.upper(),
        target_amount=payload.target_amount,
        current_amount=current_amount,
        currency=payload.currency.upper(),
        target_date=payload.target_date,
        status="ACTIVE",
        note=payload.note,
    )

    db.add(goal)
    db.flush()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="GOAL",
        entity_id=goal.id,
        title="Financial Goal Created",
        description=f"{goal.goal_name} goal created with target {goal.target_amount} {goal.currency}",
    )

    db.commit()
    db.refresh(goal)

    return serialize_goal(goal)


@router.get("/{family_id}")
def list_goals(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="goal.read",
    )

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .order_by(FinancialGoal.created_at.desc())
        .all()
    )

    return [serialize_goal(goal) for goal in goals]


@router.post("/contribute", status_code=status.HTTP_201_CREATED)
def contribute_to_goal(
    payload: GoalContributionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="goal.contribute",
    )

    goal = get_goal(db, payload.family_id, payload.goal_id)
    wallet_id = get_payload_wallet_id(payload)
    wallet = get_wallet(db, payload.family_id, wallet_id, member)

    if wallet.current_balance < payload.amount:
        raise HTTPException(400, "Insufficient wallet balance")

    linked_savings = get_linked_savings(db, goal)

    tx = Transaction(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        category_id=None,
        loan_id=None,
        goal_id=goal.id,
        transaction_type="GOAL_CONTRIBUTION",
        amount=payload.amount,
        currency=payload.currency.upper(),
        description=payload.description,
        status="POSTED",
    )

    db.add(tx)
    db.flush()

    db.add(
        TransactionLine(
            transaction_id=tx.id,
            account_id=None,
            line_type="GOAL",
            debit=payload.amount,
            credit=Decimal("0"),
            description="Debit financial goal contribution",
        )
    )

    db.add(
        TransactionLine(
            transaction_id=tx.id,
            account_id=wallet.id,
            line_type="ASSET",
            debit=Decimal("0"),
            credit=payload.amount,
            description="Credit wallet for financial goal contribution",
        )
    )

    wallet.current_balance -= payload.amount
    goal.current_amount += payload.amount

    if linked_savings:
        linked_savings.current_amount += payload.amount

    if Decimal(goal.current_amount) >= Decimal(goal.target_amount):
        goal.status = "COMPLETED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CONTRIBUTE",
        entity_type="GOAL",
        entity_id=goal.id,
        title="Goal Contribution Posted",
        description=f"Contributed {payload.amount} {payload.currency.upper()} to {goal.goal_name} from {wallet.name}",
    )

    db.commit()
    db.refresh(goal)

    return {
        "success": True,
        "transaction_id": tx.id,
        "goal_id": goal.id,
        "goal_name": goal.goal_name,
        "current_amount": money(goal.current_amount),
        "target_amount": money(goal.target_amount),
        "progress_percent": progress_percent(goal.current_amount, goal.target_amount),
        "wallet_balance": money(wallet.current_balance),
        "status": goal.status,
    }


@router.post("/withdraw", status_code=status.HTTP_201_CREATED)
def withdraw_from_goal(
    payload: GoalWithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="goal.withdraw",
    )

    goal = get_goal(db, payload.family_id, payload.goal_id)
    wallet_id = get_payload_wallet_id(payload)
    wallet = get_wallet(db, payload.family_id, wallet_id, member)

    if Decimal(goal.current_amount) < payload.amount:
        raise HTTPException(400, "Insufficient goal balance")

    linked_savings = get_linked_savings(db, goal)

    if linked_savings and Decimal(linked_savings.current_amount) < payload.amount:
        raise HTTPException(400, "Insufficient linked savings balance")

    tx = Transaction(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        category_id=None,
        loan_id=None,
        goal_id=goal.id,
        transaction_type="GOAL_WITHDRAW",
        amount=payload.amount,
        currency=payload.currency.upper(),
        description=payload.description,
        status="POSTED",
    )

    db.add(tx)
    db.flush()

    db.add(
        TransactionLine(
            transaction_id=tx.id,
            account_id=wallet.id,
            line_type="ASSET",
            debit=payload.amount,
            credit=Decimal("0"),
            description="Debit wallet from financial goal withdraw",
        )
    )

    db.add(
        TransactionLine(
            transaction_id=tx.id,
            account_id=None,
            line_type="GOAL",
            debit=Decimal("0"),
            credit=payload.amount,
            description="Credit financial goal withdraw",
        )
    )

    goal.current_amount -= payload.amount
    wallet.current_balance += payload.amount

    if linked_savings:
        linked_savings.current_amount -= payload.amount

    if goal.status == "COMPLETED" and Decimal(goal.current_amount) < Decimal(goal.target_amount):
        goal.status = "ACTIVE"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="WITHDRAW",
        entity_type="GOAL",
        entity_id=goal.id,
        title="Goal Withdraw Posted",
        description=f"Withdrew {payload.amount} {payload.currency.upper()} from {goal.goal_name} to {wallet.name}",
    )

    db.commit()
    db.refresh(goal)

    return {
        "success": True,
        "transaction_id": tx.id,
        "goal_id": goal.id,
        "goal_name": goal.goal_name,
        "current_amount": money(goal.current_amount),
        "target_amount": money(goal.target_amount),
        "progress_percent": progress_percent(goal.current_amount, goal.target_amount),
        "wallet_balance": money(wallet.current_balance),
        "status": goal.status,
    }