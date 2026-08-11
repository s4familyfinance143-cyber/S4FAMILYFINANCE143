"""
Double-Entry Accounting Engine — architecture letter-by-letter.

Every transaction writes ≥2 transaction_lines rows.
Sum(debit) == Sum(credit) or the transaction is rejected.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.services.chart_of_accounts import (
    NORMAL_DEBIT_CLASSES,
    ensure_family_chart,
    ensure_named_coa_account,
    is_spend_wallet,
    ledger_class,
)

MONEY_SCALE = Decimal("0.0001")


def _money(value: Any) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid amount") from exc
    return amount


def _money_pos(value: Any) -> Decimal:
    amount = _money(value)
    if amount <= Decimal("0"):
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    return amount


def validate_balance(
    lines: Sequence[Mapping[str, Any] | TransactionLine],
) -> tuple[Decimal, Decimal]:
    """
    Architecture: validate_balance(debit_sum == credit_sum).
    Rejects unbalanced journals and journals with fewer than 2 lines.
    """
    if lines is None or len(lines) < 2:
        raise HTTPException(
            status_code=400,
            detail="Double-entry transaction requires at least 2 transaction_lines",
        )

    debit_total = Decimal("0")
    credit_total = Decimal("0")
    positive_lines = 0

    for raw in lines:
        if isinstance(raw, TransactionLine):
            debit = _money(raw.debit or 0)
            credit = _money(raw.credit or 0)
            account_id = raw.account_id
        else:
            debit = _money(raw.get("debit") or 0)
            credit = _money(raw.get("credit") or 0)
            account_id = raw.get("account_id")

        if debit < 0 or credit < 0:
            raise HTTPException(status_code=400, detail="Debit/Credit cannot be negative")
        if debit > 0 and credit > 0:
            raise HTTPException(
                status_code=400,
                detail="A line cannot have both debit and credit",
            )
        if debit == 0 and credit == 0:
            raise HTTPException(
                status_code=400,
                detail="A line must have debit or credit amount",
            )
        if not account_id:
            raise HTTPException(
                status_code=400,
                detail="Every transaction line must reference a Chart of Accounts account_id",
            )
        positive_lines += 1
        debit_total += debit
        credit_total += credit

    if positive_lines < 2:
        raise HTTPException(
            status_code=400,
            detail="Double-entry transaction needs at least 2 posting lines",
        )

    if debit_total != credit_total:
        raise HTTPException(
            status_code=400,
            detail=f"Unbalanced transaction: debit={debit_total} credit={credit_total}",
        )

    return debit_total, credit_total


# Backward-compatible alias used by older call sites
def ensure_balanced(lines: list[TransactionLine]) -> None:
    validate_balance(lines)


def _apply_line_to_account(account: Account, debit: Decimal, credit: Decimal) -> None:
    cls = ledger_class(account.account_type)
    bal = Decimal(account.current_balance or 0)
    if cls in NORMAL_DEBIT_CLASSES:
        account.current_balance = bal + debit - credit
    else:
        account.current_balance = bal + credit - debit


def calculate_account_balance(
    db: Session,
    account_id: str,
    *,
    family_id: str | None = None,
) -> Decimal:
    """
    Ledger balance from opening_balance + posted (non-void) transaction_lines.
    ASSET/EXPENSE: opening + debits − credits
    LIABILITY/EQUITY/INCOME: opening + credits − debits
    """
    account = db.get(Account, account_id)
    if not account or account.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Account not found")
    if family_id and account.family_id != family_id:
        raise HTTPException(status_code=404, detail="Account not found")

    rows = (
        db.query(TransactionLine, Transaction)
        .join(Transaction, TransactionLine.transaction_id == Transaction.id)
        .filter(
            TransactionLine.account_id == account_id,
            TransactionLine.deleted_at.is_(None),
            Transaction.deleted_at.is_(None),
            Transaction.status == "POSTED",
        )
        .all()
    )

    if not rows:
        # Architecture: balance from journal lines only — no cache fallback
        return Decimal(account.opening_balance or 0).quantize(MONEY_SCALE)

    debit_sum = Decimal("0")
    credit_sum = Decimal("0")
    has_opening_journal = False
    for line, tx in rows:
        debit_sum += Decimal(line.debit or 0)
        credit_sum += Decimal(line.credit or 0)
        if (tx.transaction_type or "").upper() == "OPENING_BALANCE":
            has_opening_journal = True

    cls = ledger_class(account.account_type)
    if cls in NORMAL_DEBIT_CLASSES:
        line_net = debit_sum - credit_sum
    else:
        line_net = credit_sum - debit_sum

    # Legacy wallets: opening_balance not journaled — include once.
    opening = Decimal("0")
    if not has_opening_journal:
        opening = Decimal(account.opening_balance or 0)

    return (opening + line_net).quantize(MONEY_SCALE)


def sync_account_balance_cache(db: Session, account: Account) -> Decimal:
    """Refresh cached current_balance from journal lines (source of truth)."""
    bal = calculate_account_balance(db, account.id, family_id=account.family_id)
    account.current_balance = bal
    return bal


def create_transaction(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    transaction_type: str,
    amount: Any,
    currency: str,
    lines: Sequence[Mapping[str, Any]],
    category_id: str | None = None,
    loan_id: str | None = None,
    goal_id: str | None = None,
    description: str | None = None,
    client_request_id: str | None = None,
    status: str = "POSTED",
    update_balances: bool = True,
) -> Transaction:
    """
    Create a Transaction + ≥2 balanced TransactionLine rows.
    Does not commit — caller controls the transaction boundary.
    """
    validate_balance(lines)
    amount_d = _money_pos(amount)
    currency = (currency or "BDT").strip().upper()

    # Resolve & lock accounts
    account_map: dict[str, Account] = {}
    for raw in lines:
        aid = str(raw["account_id"])
        if aid in account_map:
            continue
        account = (
            db.query(Account)
            .filter(
                Account.id == aid,
                Account.family_id == family_id,
                Account.deleted_at.is_(None),
            )
            .with_for_update()
            .first()
        )
        if not account:
            raise HTTPException(status_code=404, detail=f"Account not found: {aid}")
        if not account.is_active:
            raise HTTPException(status_code=400, detail=f"Inactive account: {aid}")
        account_map[aid] = account

    tx = Transaction(
        family_id=family_id,
        created_by_member_id=member_id,
        category_id=category_id,
        loan_id=loan_id,
        goal_id=goal_id,
        transaction_type=transaction_type,
        amount=amount_d,
        currency=currency,
        description=description,
        status=status,
        client_request_id=client_request_id,
    )
    db.add(tx)
    db.flush()

    created_lines: list[TransactionLine] = []
    for raw in lines:
        aid = str(raw["account_id"])
        account = account_map[aid]
        debit = _money(raw.get("debit") or 0)
        credit = _money(raw.get("credit") or 0)
        line_type = (raw.get("line_type") or ledger_class(account.account_type)).upper()
        line = TransactionLine(
            transaction_id=tx.id,
            account_id=aid,
            line_type=line_type,
            debit=debit,
            credit=credit,
            description=raw.get("description"),
        )
        db.add(line)
        created_lines.append(line)
        if update_balances and status == "POSTED":
            _apply_line_to_account(account, debit, credit)

    db.flush()
    return tx


def generate_trial_balance(
    db: Session,
    family_id: str,
    *,
    currency: str | None = None,
) -> dict[str, Any]:
    """Trial balance from Chart of Accounts ledger balances."""
    accounts = (
        db.query(Account)
        .filter(Account.family_id == family_id, Account.deleted_at.is_(None))
        .order_by(Account.account_type, Account.name)
        .all()
    )

    rows: list[dict[str, Any]] = []
    debit_total = Decimal("0")
    credit_total = Decimal("0")

    for account in accounts:
        if currency and account.currency.upper() != currency.upper():
            continue
        bal = calculate_account_balance(db, account.id, family_id=family_id)
        cls = ledger_class(account.account_type)
        debit = Decimal("0")
        credit = Decimal("0")
        if bal == 0:
            continue
        if cls in NORMAL_DEBIT_CLASSES:
            if bal >= 0:
                debit = bal
            else:
                credit = abs(bal)
        else:
            if bal >= 0:
                credit = bal
            else:
                debit = abs(bal)
        debit_total += debit
        credit_total += credit
        rows.append(
            {
                "account_id": account.id,
                "account_name": account.name,
                "account_type": account.account_type,
                "coa_class": cls,
                "currency": account.currency,
                "debit": str(debit),
                "credit": str(credit),
                "balance": str(bal),
            }
        )

    return {
        "family_id": family_id,
        "rows": rows,
        "debit_total": str(debit_total),
        "credit_total": str(credit_total),
        "balanced": debit_total == credit_total,
    }


def generate_income_statement(
    db: Session,
    family_id: str,
    *,
    currency: str | None = None,
) -> dict[str, Any]:
    """P&L from INCOME and EXPENSE CoA accounts."""
    accounts = (
        db.query(Account)
        .filter(Account.family_id == family_id, Account.deleted_at.is_(None))
        .all()
    )

    income_rows: list[dict[str, Any]] = []
    expense_rows: list[dict[str, Any]] = []
    income_total = Decimal("0")
    expense_total = Decimal("0")

    for account in accounts:
        cls = ledger_class(account.account_type)
        if cls not in {"INCOME", "EXPENSE"}:
            continue
        if currency and account.currency.upper() != currency.upper():
            continue
        bal = calculate_account_balance(db, account.id, family_id=family_id)
        # Income/Expense balances are normally positive on their normal side
        amount = abs(bal)
        item = {
            "account_id": account.id,
            "account_name": account.name,
            "account_type": account.account_type,
            "currency": account.currency,
            "amount": str(amount),
        }
        if cls == "INCOME":
            income_total += amount
            income_rows.append(item)
        else:
            expense_total += amount
            expense_rows.append(item)

    net = income_total - expense_total
    return {
        "family_id": family_id,
        "income": income_rows,
        "expense": expense_rows,
        "total_income": str(income_total),
        "total_expense": str(expense_total),
        "net_income": str(net),
    }


def generate_cash_flow(
    db: Session,
    family_id: str,
    *,
    currency: str | None = None,
) -> dict[str, Any]:
    """
    Cash-flow style summary from posted wallet (ASSET subtype) lines,
    classified by transaction_type.
    """
    wallet_ids = [
        a.id
        for a in db.query(Account)
        .filter(Account.family_id == family_id, Account.deleted_at.is_(None))
        .all()
        if is_spend_wallet(a)
        and (not currency or a.currency.upper() == currency.upper())
    ]

    operating_in = Decimal("0")
    operating_out = Decimal("0")
    financing_in = Decimal("0")
    financing_out = Decimal("0")
    investing_in = Decimal("0")
    investing_out = Decimal("0")

    if not wallet_ids:
        return {
            "family_id": family_id,
            "operating": {"inflow": "0", "outflow": "0", "net": "0"},
            "financing": {"inflow": "0", "outflow": "0", "net": "0"},
            "investing": {"inflow": "0", "outflow": "0", "net": "0"},
            "net_cash_flow": "0",
        }

    rows = (
        db.query(TransactionLine, Transaction)
        .join(Transaction, TransactionLine.transaction_id == Transaction.id)
        .filter(
            TransactionLine.account_id.in_(wallet_ids),
            TransactionLine.deleted_at.is_(None),
            Transaction.deleted_at.is_(None),
            Transaction.status == "POSTED",
            Transaction.family_id == family_id,
        )
        .all()
    )

    for line, tx in rows:
        debit = Decimal(line.debit or 0)
        credit = Decimal(line.credit or 0)
        ttype = (tx.transaction_type or "").upper()

        if ttype in {"INCOME"} or ttype.endswith("_INCOME"):
            operating_in += debit
            operating_out += credit
        elif ttype in {"EXPENSE"} or ttype.endswith("_EXPENSE"):
            operating_in += debit
            operating_out += credit
        elif "LOAN" in ttype:
            financing_in += debit
            financing_out += credit
        elif ttype in {"TRANSFER", "OPENING_BALANCE", "ROLLBACK"}:
            # internal / non-cash-flow for classification
            continue
        elif "GOAL" in ttype or "SAVINGS" in ttype:
            investing_in += debit
            investing_out += credit
        else:
            operating_in += debit
            operating_out += credit

    op_net = operating_in - operating_out
    fin_net = financing_in - financing_out
    inv_net = investing_in - investing_out
    net = op_net + fin_net + inv_net

    return {
        "family_id": family_id,
        "operating": {
            "inflow": str(operating_in),
            "outflow": str(operating_out),
            "net": str(op_net),
        },
        "financing": {
            "inflow": str(financing_in),
            "outflow": str(financing_out),
            "net": str(fin_net),
        },
        "investing": {
            "inflow": str(investing_in),
            "outflow": str(investing_out),
            "net": str(inv_net),
        },
        "net_cash_flow": str(net),
    }


def rollback_transaction(
    db: Session,
    *,
    transaction_id: str,
    member_id: str,
    reason: str | None = None,
) -> dict[str, Any]:
    """
    Reverse a posted journal: write opposing lines, mark original VOID.
    """
    tx = db.get(Transaction, transaction_id)
    if not tx or tx.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if str(tx.status or "").upper() == "VOID":
        raise HTTPException(status_code=400, detail="Transaction already void")

    lines = (
        db.query(TransactionLine)
        .filter(
            TransactionLine.transaction_id == tx.id,
            TransactionLine.deleted_at.is_(None),
        )
        .all()
    )
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Cannot rollback unbalanced/incomplete journal")

    reverse_payload = [
        {
            "account_id": line.account_id,
            "debit": line.credit or Decimal("0"),
            "credit": line.debit or Decimal("0"),
            "line_type": line.line_type,
            "description": f"Rollback of {tx.id}" + (f": {reason}" if reason else ""),
        }
        for line in lines
        if line.account_id
    ]
    if len(reverse_payload) < 2:
        raise HTTPException(status_code=400, detail="Cannot rollback: missing account_ids on lines")

    reversing = create_transaction(
        db,
        family_id=tx.family_id,
        member_id=member_id,
        transaction_type="ROLLBACK",
        amount=tx.amount,
        currency=tx.currency,
        lines=reverse_payload,
        category_id=tx.category_id,
        loan_id=tx.loan_id,
        goal_id=tx.goal_id,
        description=reason or f"Rollback of {tx.id}",
        status="POSTED",
        update_balances=True,
    )

    tx.status = "VOID"
    tx.deleted_at = datetime.now(timezone.utc)
    db.flush()

    return {
        "original_id": tx.id,
        "rollback_id": reversing.id,
        "status": "VOID",
    }


# ---------------------------------------------------------------------------
# Journal helpers matching architecture examples
# ---------------------------------------------------------------------------


def _wallet_or_404(db: Session, family_id: str, account_id: str) -> Account:
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Wallet not found")
    if not account.is_active:
        raise HTTPException(status_code=400, detail="Wallet inactive")
    return account


def post_income(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    account: Account | None = None,
    account_id: str | None = None,
    category_id: str | None = None,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    income_account_name: str | None = None,
    client_request_id: str | None = None,
    commit: bool = False,
) -> Transaction:
    """Salary/Income: Dr Cash(ASSET), Cr Salary Income(INCOME)."""
    amount_d = _money_pos(amount)
    currency = (currency or "BDT").strip().upper()
    wallet = account or _wallet_or_404(db, family_id, str(account_id))
    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    income_name = income_account_name or "Salary Income"
    income_acct = ensure_named_coa_account(
        db,
        family_id=family_id,
        owner_member_id=member_id,
        name=income_name,
        account_type="INCOME",
        currency=currency,
    )

    tx = create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="INCOME",
        amount=amount_d,
        currency=currency,
        category_id=category_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit wallet for income",
            },
            {
                "account_id": income_acct.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "INCOME",
                "description": "Credit income",
            },
        ],
    )
    # silence unused chart binding for linters when only defaults used
    _ = chart
    if commit:
        db.commit()
        db.refresh(tx)
    return tx


def post_expense(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    account: Account | None = None,
    account_id: str | None = None,
    category_id: str | None = None,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    expense_account_name: str | None = None,
    client_request_id: str | None = None,
    commit: bool = False,
) -> Transaction:
    """Grocery/Expense: Dr Expense(EXPENSE), Cr Cash(ASSET)."""
    amount_d = _money_pos(amount)
    currency = (currency or "BDT").strip().upper()
    wallet = account or _wallet_or_404(db, family_id, str(account_id))
    if wallet.currency.upper() != currency:
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")
    if Decimal(wallet.current_balance or 0) < amount_d:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    ensure_family_chart(db, family_id=family_id, owner_member_id=member_id, currency=currency)
    expense_name = expense_account_name or "General Expense"
    expense_acct = ensure_named_coa_account(
        db,
        family_id=family_id,
        owner_member_id=member_id,
        name=expense_name,
        account_type="EXPENSE",
        currency=currency,
    )

    tx = create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="EXPENSE",
        amount=amount_d,
        currency=currency,
        category_id=category_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": expense_acct.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "EXPENSE",
                "description": "Debit expense",
            },
            {
                "account_id": wallet.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit wallet for expense",
            },
        ],
    )
    if commit:
        db.commit()
        db.refresh(tx)
    return tx


def post_transfer(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    from_account: Account | None = None,
    to_account: Account | None = None,
    from_account_id: str | None = None,
    to_account_id: str | None = None,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    client_request_id: str | None = None,
    commit: bool = False,
) -> Transaction:
    amount_d = _money_pos(amount)
    currency = (currency or "BDT").strip().upper()
    src = from_account or _wallet_or_404(db, family_id, str(from_account_id))
    dst = to_account or _wallet_or_404(db, family_id, str(to_account_id))
    if src.id == dst.id:
        raise HTTPException(400, "Cannot transfer to same wallet")
    if src.currency.upper() != currency or dst.currency.upper() != currency:
        raise HTTPException(400, "Currency mismatch")
    if Decimal(src.current_balance or 0) < amount_d:
        raise HTTPException(400, "Insufficient source wallet balance")

    tx = create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="TRANSFER",
        amount=amount_d,
        currency=currency,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": dst.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit destination wallet",
            },
            {
                "account_id": src.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit source wallet",
            },
        ],
    )
    if commit:
        db.commit()
        db.refresh(tx)
    return tx


def post_loan_taken(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    loan_id: str | None = None,
    description: str | None = None,
) -> Transaction:
    """Loan taken: Dr Cash(ASSET), Cr Loan Payable(LIABILITY)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    payable = chart["loan_payable"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="LOAN_TAKEN",
        amount=amount_d,
        currency=currency,
        loan_id=loan_id,
        description=description,
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit wallet for taken loan",
            },
            {
                "account_id": payable.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "LIABILITY",
                "description": "Credit loan payable",
            },
        ],
    )


def post_loan_given(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    loan_id: str | None = None,
    description: str | None = None,
) -> Transaction:
    """Loan given: Dr Loan Receivable(ASSET), Cr Cash(ASSET)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    if Decimal(wallet.current_balance or 0) < amount_d:
        raise HTTPException(400, "Insufficient wallet balance")
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    receivable = chart["loan_receivable"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="LOAN_GIVEN",
        amount=amount_d,
        currency=currency,
        loan_id=loan_id,
        description=description,
        lines=[
            {
                "account_id": receivable.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit loan receivable",
            },
            {
                "account_id": wallet.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit wallet for given loan",
            },
        ],
    )


def post_loan_installment(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    loan_type: str,
    loan_id: str | None = None,
    description: str | None = None,
) -> Transaction:
    """
    Loan installment:
    - TAKEN payment: Dr Loan Payable(LIABILITY), Cr Cash(ASSET)
    - GIVEN repayment: Dr Cash(ASSET), Cr Loan Receivable(ASSET)
    """
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    loan_type_u = loan_type.strip().upper()

    if loan_type_u == "TAKEN":
        if Decimal(wallet.current_balance or 0) < amount_d:
            raise HTTPException(400, "Insufficient wallet balance")
        payable = chart["loan_payable"]
        return create_transaction(
            db,
            family_id=family_id,
            member_id=member_id,
            transaction_type="LOAN_TAKEN_PAYMENT",
            amount=amount_d,
            currency=currency,
            loan_id=loan_id,
            description=description,
            lines=[
                {
                    "account_id": payable.id,
                    "debit": amount_d,
                    "credit": Decimal("0"),
                    "line_type": "LIABILITY",
                    "description": "Debit loan payable",
                },
                {
                    "account_id": wallet.id,
                    "debit": Decimal("0"),
                    "credit": amount_d,
                    "line_type": "ASSET",
                    "description": "Credit wallet loan payment",
                },
            ],
        )

    # GIVEN repayment received
    receivable = chart["loan_receivable"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="LOAN_GIVEN_PAYMENT",
        amount=amount_d,
        currency=currency,
        loan_id=loan_id,
        description=description,
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit wallet loan repayment received",
            },
            {
                "account_id": receivable.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit loan receivable",
            },
        ],
    )


def post_savings_deposit(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    goal_id: str | None = None,
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    """Savings deposit: Dr Savings Pool(ASSET), Cr Cash(ASSET)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    if Decimal(wallet.current_balance or 0) < amount_d:
        raise HTTPException(400, "Insufficient wallet balance")
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    pool = chart["savings_pool"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="SAVINGS_DEPOSIT",
        amount=amount_d,
        currency=currency,
        goal_id=goal_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": pool.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit savings pool",
            },
            {
                "account_id": wallet.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit wallet for savings deposit",
            },
        ],
    )


def post_savings_withdraw(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    goal_id: str | None = None,
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    """Savings withdraw: Dr Cash(ASSET), Cr Savings Pool(ASSET)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    pool = chart["savings_pool"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="SAVINGS_WITHDRAW",
        amount=amount_d,
        currency=currency,
        goal_id=goal_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit wallet for savings withdraw",
            },
            {
                "account_id": pool.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit savings pool",
            },
        ],
    )


def post_goal_contribute(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    goal_id: str | None = None,
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    """Goal contribute: Dr Goal Pool(ASSET), Cr Cash(ASSET)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    if Decimal(wallet.current_balance or 0) < amount_d:
        raise HTTPException(400, "Insufficient wallet balance")
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    pool = chart["goal_pool"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="GOAL_CONTRIBUTION",
        amount=amount_d,
        currency=currency,
        goal_id=goal_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": pool.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit goal pool",
            },
            {
                "account_id": wallet.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit wallet for goal contribution",
            },
        ],
    )


def post_goal_withdraw(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Any,
    currency: str,
    goal_id: str | None = None,
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    """Goal withdraw: Dr Cash(ASSET), Cr Goal Pool(ASSET)."""
    amount_d = _money_pos(amount)
    currency = currency.strip().upper()
    chart = ensure_family_chart(
        db, family_id=family_id, owner_member_id=member_id, currency=currency
    )
    pool = chart["goal_pool"]
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="GOAL_WITHDRAW",
        amount=amount_d,
        currency=currency,
        goal_id=goal_id,
        description=description,
        client_request_id=client_request_id,
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit wallet from goal withdraw",
            },
            {
                "account_id": pool.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "ASSET",
                "description": "Credit goal pool",
            },
        ],
    )


def post_opening_balance(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    wallet: Account,
    amount: Decimal,
) -> Transaction | None:
    """Opening: Dr Wallet(ASSET), Cr Opening Equity(EQUITY)."""
    amount_d = _money(amount)
    if amount_d == 0:
        return None
    if amount_d < 0:
        raise HTTPException(400, "Opening balance cannot be negative")
    chart = ensure_family_chart(
        db,
        family_id=family_id,
        owner_member_id=member_id,
        currency=wallet.currency,
    )
    equity = chart["opening_equity"]
    # Keep opening_balance as recorded initial; current starts at 0 then journal applies.
    wallet.current_balance = Decimal("0")
    return create_transaction(
        db,
        family_id=family_id,
        member_id=member_id,
        transaction_type="OPENING_BALANCE",
        amount=amount_d,
        currency=wallet.currency,
        description=f"Opening balance for {wallet.name}",
        lines=[
            {
                "account_id": wallet.id,
                "debit": amount_d,
                "credit": Decimal("0"),
                "line_type": "ASSET",
                "description": "Debit opening wallet",
            },
            {
                "account_id": equity.id,
                "debit": Decimal("0"),
                "credit": amount_d,
                "line_type": "EQUITY",
                "description": "Credit opening equity",
            },
        ],
    )


def repair_legacy_null_account_lines(
    db: Session,
    *,
    family_id: str | None = None,
    owner_member_id: str | None = None,
) -> dict[str, Any]:
    """
    Complete cutover for old journals that used line_type counters with account_id=NULL.
    Assigns real CoA account_ids so every line matches architecture.
    """
    from app.services.chart_of_accounts import ensure_family_chart

    q = (
        db.query(TransactionLine, Transaction)
        .join(Transaction, TransactionLine.transaction_id == Transaction.id)
        .filter(
            TransactionLine.account_id.is_(None),
            TransactionLine.deleted_at.is_(None),
            Transaction.deleted_at.is_(None),
        )
    )
    if family_id:
        q = q.filter(Transaction.family_id == family_id)

    rows = q.all()
    fixed = 0
    skipped = 0
    chart_cache: dict[str, dict] = {}

    for line, tx in rows:
        fid = tx.family_id
        member_id = owner_member_id or tx.created_by_member_id
        if fid not in chart_cache:
            chart_cache[fid] = ensure_family_chart(
                db,
                family_id=fid,
                owner_member_id=member_id,
                currency=tx.currency or "BDT",
            )
        chart = chart_cache[fid]
        lt = (line.line_type or "").upper()
        desc = (line.description or "").lower()

        target = None
        if lt in {"INCOME"}:
            target = chart["salary_income"]
        elif lt in {"EXPENSE"}:
            if "grocery" in desc or "bazaar" in desc:
                target = chart["grocery_expense"]
            else:
                target = chart["general_expense"]
        elif lt in {"LOAN_PAYABLE", "LIABILITY"}:
            target = chart["loan_payable"]
            line.line_type = "LIABILITY"
        elif lt in {"LOAN_RECEIVABLE"}:
            target = chart["loan_receivable"]
            line.line_type = "ASSET"
        elif lt in {"SAVINGS"}:
            target = chart["savings_pool"]
            line.line_type = "ASSET"
        elif lt in {"GOAL"}:
            target = chart["goal_pool"]
            line.line_type = "ASSET"
        elif lt in {"ASSET"}:
            skipped += 1
            continue
        else:
            if Decimal(line.credit or 0) > 0:
                target = chart["other_income"]
                line.line_type = "INCOME"
            else:
                target = chart["general_expense"]
                line.line_type = "EXPENSE"

        if target is None:
            skipped += 1
            continue
        line.account_id = target.id
        fixed += 1

    db.flush()
    return {"fixed": fixed, "skipped": skipped, "scanned": len(rows)}
