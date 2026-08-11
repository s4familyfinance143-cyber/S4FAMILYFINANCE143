"""Chart of Accounts helpers — ASSET / LIABILITY / EQUITY / INCOME / EXPENSE."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.account import Account

# Architecture CoA classes (letter-by-letter — exactly these five)
COA_CLASSES = frozenset({"ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"})

# Wallet subtypes — architecture: Cash · Bank · bKash/Nagad/Rocket · Card · Gold/Asset
WALLET_SUBTYPES = frozenset(
    {
        "CASH",
        "BANK",
        "BKASH",
        "NAGAD",
        "ROCKET",
        "MOBILE",  # legacy alias → treated as mobile banking ASSET
        "CARD",
        "GOLD",
        "SAVINGS",
        "ASSET",
    }
)

# Legacy aliases remapped to exact CoA classes / wallet names
LEGACY_TYPE_MAP = {
    "LOAN_PAYABLE": "LIABILITY",
    "LOAN_RECEIVABLE": "ASSET",
    "SAVINGS_POOL": "ASSET",
    "GOAL_POOL": "ASSET",
    "MOBILE_BANKING": "MOBILE",
    "BKASH_WALLET": "BKASH",
    "NAGAD_WALLET": "NAGAD",
    "ROCKET_WALLET": "ROCKET",
}

VALID_ACCOUNT_TYPES = WALLET_SUBTYPES | COA_CLASSES

NORMAL_DEBIT_CLASSES = frozenset({"ASSET", "EXPENSE"})
NORMAL_CREDIT_CLASSES = frozenset({"LIABILITY", "EQUITY", "INCOME"})

# Exact architecture system CoA accounts (types are the five classes only)
SYSTEM_ACCOUNT_SPECS = (
    {"name": "Opening Equity", "account_type": "EQUITY", "key": "opening_equity"},
    {"name": "Salary Income", "account_type": "INCOME", "key": "salary_income"},
    {"name": "Other Income", "account_type": "INCOME", "key": "other_income"},
    {"name": "Grocery Expense", "account_type": "EXPENSE", "key": "grocery_expense"},
    {"name": "General Expense", "account_type": "EXPENSE", "key": "general_expense"},
    {"name": "Loan Payable", "account_type": "LIABILITY", "key": "loan_payable"},
    {"name": "Loan Receivable", "account_type": "ASSET", "key": "loan_receivable"},
    {"name": "Savings Pool", "account_type": "ASSET", "key": "savings_pool"},
    {"name": "Goal Pool", "account_type": "ASSET", "key": "goal_pool"},
)

SYSTEM_ACCOUNT_NAMES = frozenset(spec["name"] for spec in SYSTEM_ACCOUNT_SPECS)


def normalize_account_type(account_type: str | None) -> str:
    t = (account_type or "").strip().upper()
    return LEGACY_TYPE_MAP.get(t, t)


def ledger_class(account_type: str | None) -> str:
    """Map stored account_type → architecture CoA class (exactly 5)."""
    t = normalize_account_type(account_type)
    if t in COA_CLASSES:
        return t
    if t in WALLET_SUBTYPES:
        return "ASSET"
    return "ASSET"


def is_wallet_type(account_type: str | None) -> bool:
    t = normalize_account_type(account_type)
    return t in WALLET_SUBTYPES


def is_spend_wallet(account: Account) -> bool:
    """User-facing wallets only — exclude system CoA rows even if type is ASSET."""
    if getattr(account, "is_system", False):
        return False
    if account.name in SYSTEM_ACCOUNT_NAMES:
        return False
    return is_wallet_type(account.account_type)


def _ensure_is_system_column(db: Session) -> None:
    """Best-effort add accounts.is_system if migration not applied yet."""
    try:
        dialect = db.bind.dialect.name if db.bind is not None else ""
        if dialect == "sqlite":
            cols = {
                row[1]
                for row in db.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(accounts)")
                ).fetchall()
            }
            if "is_system" not in cols:
                db.execute(
                    __import__("sqlalchemy").text(
                        "ALTER TABLE accounts ADD COLUMN is_system BOOLEAN DEFAULT 0"
                    )
                )
        else:
            db.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE"
                )
            )
    except Exception:
        pass


def ensure_system_account(
    db: Session,
    *,
    family_id: str,
    owner_member_id: str,
    name: str,
    account_type: str,
    currency: str = "BDT",
) -> Account:
    _ensure_is_system_column(db)
    account_type = normalize_account_type(account_type)
    if account_type not in COA_CLASSES:
        account_type = ledger_class(account_type)

    # Match by name so legacy LOAN_PAYABLE rows upgrade to LIABILITY etc.
    row = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.name == name,
            Account.deleted_at.is_(None),
        )
        .first()
    )
    if row:
        if row.account_type != account_type:
            row.account_type = account_type
        if hasattr(row, "is_system"):
            row.is_system = True
        return row

    row = Account(
        family_id=family_id,
        owner_member_id=owner_member_id,
        name=name,
        account_type=account_type,
        currency=(currency or "BDT").strip().upper(),
        opening_balance=Decimal("0"),
        current_balance=Decimal("0"),
        is_shared_family=True,
        is_owner_wallet=False,
        is_active=True,
        is_system=True,
    )
    db.add(row)
    db.flush()
    return row


def ensure_family_chart(
    db: Session,
    *,
    family_id: str,
    owner_member_id: str,
    currency: str = "BDT",
) -> dict[str, Account]:
    """Bootstrap architecture system CoA accounts for a family."""
    out: dict[str, Account] = {}
    for spec in SYSTEM_ACCOUNT_SPECS:
        out[spec["key"]] = ensure_system_account(
            db,
            family_id=family_id,
            owner_member_id=owner_member_id,
            name=spec["name"],
            account_type=spec["account_type"],
            currency=currency,
        )
    return out


def ensure_named_coa_account(
    db: Session,
    *,
    family_id: str,
    owner_member_id: str,
    name: str,
    account_type: str,
    currency: str = "BDT",
) -> Account:
    """Find-or-create a named INCOME/EXPENSE (etc.) account for journal counterparts."""
    name = (name or "").strip() or (
        "Other Income" if account_type.upper() == "INCOME" else "General Expense"
    )
    account_type = normalize_account_type(account_type)
    if account_type not in COA_CLASSES:
        account_type = ledger_class(account_type)

    row = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.name == name,
            Account.deleted_at.is_(None),
        )
        .first()
    )
    if row:
        if row.account_type != account_type:
            row.account_type = account_type
        if hasattr(row, "is_system"):
            row.is_system = True
        return row
    return ensure_system_account(
        db,
        family_id=family_id,
        owner_member_id=owner_member_id,
        name=name,
        account_type=account_type,
        currency=currency,
    )
