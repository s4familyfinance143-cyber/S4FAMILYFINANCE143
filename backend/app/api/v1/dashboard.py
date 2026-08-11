from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.budget import Budget
from app.models.goal import FinancialGoal
from app.models.loan import Loan
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction
from app.models.user import User
from app.models.family import Family
from app.models.currency import ExchangeRate
from app.services.finance_posting import _ensure_client_request_id_column
from app.services.permission_service import require_permission

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])




def get_rate_to_base(db, from_currency, to_currency, rate_date=None):
    from_currency = str(from_currency or "").upper().strip()
    to_currency = str(to_currency or "").upper().strip()

    if from_currency == to_currency:
        return Decimal("1")

    if rate_date:
        historical = (
            db.query(ExchangeRate)
            .filter(
                ExchangeRate.from_currency == from_currency,
                ExchangeRate.to_currency == to_currency,
                ExchangeRate.is_active.is_(True),
                ExchangeRate.deleted_at.is_(None),
                ExchangeRate.rate_date <= rate_date,
            )
            .order_by(ExchangeRate.rate_date.desc())
            .first()
        )

        if historical:
            return Decimal(str(historical.rate))

    latest = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.is_active.is_(True),
            ExchangeRate.deleted_at.is_(None),
        )
        .order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if latest:
        return Decimal(str(latest.rate))

    return Decimal("0")

def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def percent(current, target):
    current = Decimal(current or 0)
    target = Decimal(target or 0)

    if target <= 0:
        return "0.00"

    return str(((current / target) * Decimal("100")).quantize(Decimal("0.01")))


@router.get("/{family_id}")
def dashboard_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    from app.services.redis_cache import cache_get, cache_set

    cache_key = f"dashboard:summary:{family_id}"
    cached = cache_get(cache_key)
    if isinstance(cached, dict):
        return {**cached, "_cache": "hit"}

    _ensure_client_request_id_column(db)

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .all()
    )

    savings_goals = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .all()
    )

    total_wallet_balance = sum(
        Decimal(account.current_balance or 0)
        for account in accounts
    )

    total_income = Decimal("0")
    total_expense = Decimal("0")
    total_transfer = Decimal("0")

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            total_income += amount
        elif tx.transaction_type == "EXPENSE":
            total_expense += amount
        elif tx.transaction_type == "TRANSFER":
            total_transfer += amount

    total_savings_target = sum(
        Decimal(goal.target_amount or 0)
        for goal in savings_goals
    )

    total_savings_current = sum(
        Decimal(goal.current_amount or 0)
        for goal in savings_goals
    )

    loan_given_remaining = Decimal("0")
    loan_taken_remaining = Decimal("0")

    for loan in loans:
        if loan.loan_type == "GIVEN":
            loan_given_remaining += Decimal(loan.remaining_amount or 0)
        elif loan.loan_type == "TAKEN":
            loan_taken_remaining += Decimal(loan.remaining_amount or 0)

    total_goal_target = sum(
        Decimal(goal.target_amount or 0)
        for goal in goals
    )

    total_goal_current = sum(
        Decimal(goal.current_amount or 0)
        for goal in goals
    )

    active_budget_count = 0
    over_budget_count = 0

    for budget in budgets:
        if budget.status == "ACTIVE":
            active_budget_count += 1

        if Decimal(budget.spent_amount or 0) > Decimal(budget.budget_amount or 0):
            over_budget_count += 1

    recent_transactions = sorted(
        transactions,
        key=lambda tx: tx.created_at,
        reverse=True,
    )[:10]

    payload = {
        "family_id": family_id,
        "summary": {
            "wallet_count": len(accounts),
            "total_wallet_balance": money(total_wallet_balance),
            "total_income": money(total_income),
            "total_expense": money(total_expense),
            "net_income_expense": money(total_income - total_expense),
            "total_transfer": money(total_transfer),
            "transaction_count": len(transactions),
        },
        "savings": {
            "goal_count": len(savings_goals),
            "total_target_amount": money(total_savings_target),
            "total_current_amount": money(total_savings_current),
            "overall_progress_percent": percent(
                total_savings_current,
                total_savings_target,
            ),
        },
        "loans": {
            "loan_count": len(loans),
            "loan_given_remaining": money(loan_given_remaining),
            "loan_taken_remaining": money(loan_taken_remaining),
            "net_loan_position": money(
                loan_given_remaining - loan_taken_remaining
            ),
        },
        "goals": {
            "goal_count": len(goals),
            "total_target_amount": money(total_goal_target),
            "total_current_amount": money(total_goal_current),
            "overall_progress_percent": percent(
                total_goal_current,
                total_goal_target,
            ),
        },
        "budgets": {
            "budget_count": len(budgets),
            "active_budget_count": active_budget_count,
            "over_budget_count": over_budget_count,
        },
        "wallets": [
            {
                "id": account.id,
                "name": account.name,
                "account_type": account.account_type,
                "balance": money(account.current_balance),
                "currency": account.currency,
                "is_owner_wallet": account.is_owner_wallet,
                "is_shared_family": account.is_shared_family,
            }
            for account in accounts
        ],
        "recent_transactions": [
            {
                "id": tx.id,
                "transaction_type": tx.transaction_type,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "description": tx.description,
                "created_at": tx.created_at,
            }
            for tx in recent_transactions
        ],
    }
    cache_set(cache_key, payload, ttl_seconds=45)
    return {**payload, "_cache": "miss"}

@router.get("/{family_id}/currency")
def dashboard_currency_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )

    total_balance = Decimal("0")

    wallets = []

    for account in accounts:
        balance = Decimal(account.current_balance or 0)

        rate = get_rate_to_base(
            db,
            account.currency,
            base_currency,
        )

        converted = balance * rate

        total_balance += converted

        wallets.append({
            "wallet_name": account.name,
            "currency": account.currency,
            "balance": money(balance),
            "rate": money(rate),
            "converted_balance": money(converted),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "total_balance": money(total_balance),
        "wallets": wallets,
    }



@router.get("/{family_id}/networth-currency")
def networth_currency_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = db.query(Account).filter(
        Account.family_id == family_id,
        Account.is_active.is_(True),
        Account.deleted_at.is_(None),
    ).all()

    savings_goals = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    wallet_total = Decimal("0")
    savings_total = Decimal("0")
    loan_given_total = Decimal("0")
    loan_taken_total = Decimal("0")

    wallet_items = []
    savings_items = []
    loan_items = []

    for account in accounts:
        amount = Decimal(account.current_balance or 0)
        rate = get_rate_to_base(db, account.currency, base_currency)
        converted = amount * rate
        wallet_total += converted

        wallet_items.append({
            "name": account.name,
            "currency": account.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for saving in savings_goals:
        amount = Decimal(saving.current_amount or 0)
        rate = get_rate_to_base(db, saving.currency, base_currency)
        converted = amount * rate
        savings_total += converted

        savings_items.append({
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = get_rate_to_base(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            loan_given_total += converted
        elif loan.loan_type == "TAKEN":
            loan_taken_total += converted

        loan_items.append({
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "remaining_amount": money(amount),
            "rate": money(rate),
            "converted_remaining_amount": money(converted),
        })

    net_worth = wallet_total + savings_total + loan_given_total - loan_taken_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_balance": money(wallet_total),
            "savings_balance": money(savings_total),
            "loan_given_remaining": money(loan_given_total),
            "loan_taken_remaining": money(loan_taken_total),
            "net_worth": money(net_worth),
        },
        "wallets": wallet_items,
        "savings": savings_items,
        "loans": loan_items,
    }



@router.get("/{family_id}/full-currency")
def full_currency_dashboard(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = db.query(Account).filter(
        Account.family_id == family_id,
        Account.is_active.is_(True),
        Account.deleted_at.is_(None),
    ).all()

    transactions = db.query(Transaction).filter(
        Transaction.family_id == family_id,
        Transaction.status == "POSTED",
        Transaction.deleted_at.is_(None),
    ).all()

    savings_goals = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    budgets = db.query(Budget).filter(
        Budget.family_id == family_id,
        Budget.deleted_at.is_(None),
    ).all()

    wallet_balance_base = Decimal("0")
    income_base = Decimal("0")
    expense_base = Decimal("0")
    transfer_base = Decimal("0")
    savings_target_base = Decimal("0")
    savings_current_base = Decimal("0")
    goal_target_base = Decimal("0")
    goal_current_base = Decimal("0")
    loan_given_base = Decimal("0")
    loan_taken_base = Decimal("0")

    wallet_rows = []
    recent_rows = []

    for account in accounts:
        amount = Decimal(account.current_balance or 0)
        rate = get_rate_to_base(db, account.currency, base_currency)
        converted = amount * rate

        wallet_balance_base += converted

        wallet_rows.append({
            "id": account.id,
            "name": account.name,
            "account_type": account.account_type,
            "currency": account.currency,
            "balance": money(amount),
            "rate": money(rate),
            "converted_balance": money(converted),
            "base_currency": base_currency,
        })

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = get_rate_to_base(db, tx.currency, base_currency, tx.created_at.date())
        converted = amount * rate

        if tx.transaction_type == "INCOME":
            income_base += converted
        elif tx.transaction_type == "EXPENSE":
            expense_base += converted
        elif tx.transaction_type == "TRANSFER":
            transfer_base += converted

    for saving in savings_goals:
        rate = get_rate_to_base(db, saving.currency, base_currency)
        savings_target_base += Decimal(saving.target_amount or 0) * rate
        savings_current_base += Decimal(saving.current_amount or 0) * rate

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        rate = get_rate_to_base(db, goal_currency, base_currency)
        goal_target_base += Decimal(goal.target_amount or 0) * rate
        goal_current_base += Decimal(goal.current_amount or 0) * rate

    for loan in loans:
        rate = get_rate_to_base(db, loan.currency, base_currency)
        converted_remaining = Decimal(loan.remaining_amount or 0) * rate

        if loan.loan_type == "GIVEN":
            loan_given_base += converted_remaining
        elif loan.loan_type == "TAKEN":
            loan_taken_base += converted_remaining

    active_budget_count = sum(1 for b in budgets if b.status == "ACTIVE")
    over_budget_count = sum(
        1 for b in budgets
        if Decimal(b.spent_amount or 0) > Decimal(b.budget_amount or 0)
    )

    net_income_expense = income_base - expense_base
    net_loan_position = loan_given_base - loan_taken_base
    net_worth = wallet_balance_base + savings_current_base + loan_given_base - loan_taken_base

    recent_transactions = sorted(
        transactions,
        key=lambda tx: tx.created_at,
        reverse=True,
    )[:10]

    for tx in recent_transactions:
        amount = Decimal(tx.amount or 0)
        rate = get_rate_to_base(db, tx.currency, base_currency, tx.created_at.date())
        converted = amount * rate

        recent_rows.append({
            "id": tx.id,
            "transaction_type": tx.transaction_type,
            "amount": money(amount),
            "currency": tx.currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "base_currency": base_currency,
            "description": tx.description,
            "created_at": tx.created_at,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_count": len(accounts),
            "total_wallet_balance": money(wallet_balance_base),
            "total_income": money(income_base),
            "total_expense": money(expense_base),
            "net_income_expense": money(net_income_expense),
            "total_transfer": money(transfer_base),
            "transaction_count": len(transactions),
            "net_worth": money(net_worth),
        },
        "savings": {
            "goal_count": len(savings_goals),
            "total_target_amount": money(savings_target_base),
            "total_current_amount": money(savings_current_base),
            "overall_progress_percent": percent(savings_current_base, savings_target_base),
        },
        "loans": {
            "loan_count": len(loans),
            "loan_given_remaining": money(loan_given_base),
            "loan_taken_remaining": money(loan_taken_base),
            "net_loan_position": money(net_loan_position),
        },
        "goals": {
            "goal_count": len(goals),
            "total_target_amount": money(goal_target_base),
            "total_current_amount": money(goal_current_base),
            "overall_progress_percent": percent(goal_current_base, goal_target_base),
        },
        "budgets": {
            "budget_count": len(budgets),
            "active_budget_count": active_budget_count,
            "over_budget_count": over_budget_count,
        },
        "wallets": wallet_rows,
        "recent_transactions": recent_rows,
    }

