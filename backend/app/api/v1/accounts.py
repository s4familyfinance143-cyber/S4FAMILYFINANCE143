from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.family_member import FamilyMember
from app.models.user import User
from app.schemas.account import AccountCreateRequest, AccountResponse
from app.services import accounting_service
from app.services.audit_service import write_audit_log
from app.services.chart_of_accounts import VALID_ACCOUNT_TYPES, is_spend_wallet
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/accounts", tags=["Accounts / Wallets"])


def can_view_wallet(member: FamilyMember, account: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role in {"MEMBER", "SPOUSE"}:
        return (
            account.is_shared_family is True
            or account.is_owner_wallet is True
            or account.owner_member_id == member.id
        )

    return account.owner_member_id == member.id or account.is_shared_family is True


def serialize_wallet(db: Session, account: Account) -> AccountResponse:
    """Architecture: current_balance always from journal lines."""
    bal = accounting_service.sync_account_balance_cache(db, account)
    return AccountResponse(
        id=account.id,
        family_id=account.family_id,
        owner_member_id=account.owner_member_id,
        name=account.name,
        account_type=account.account_type,
        currency=account.currency,
        opening_balance=Decimal(account.opening_balance or 0),
        current_balance=bal,
        institution_name=account.institution_name,
        account_number_masked=account.account_number_masked,
        is_shared_family=bool(account.is_shared_family),
        is_owner_wallet=bool(account.is_owner_wallet),
        is_active=bool(account.is_active),
        is_system=bool(getattr(account, "is_system", False)),
    )


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="wallet.create",
    )

    account_type = payload.account_type.upper().strip()

    if account_type not in VALID_ACCOUNT_TYPES:
        raise HTTPException(400, "Invalid account type")

    account = Account(
        family_id=payload.family_id,
        owner_member_id=member.id,
        name=payload.name.strip(),
        account_type=account_type,
        currency=payload.currency.upper().strip(),
        opening_balance=payload.opening_balance,
        current_balance=Decimal("0"),
        institution_name=payload.institution_name,
        account_number_masked=payload.account_number_masked,
        is_shared_family=payload.is_shared_family,
        is_owner_wallet=payload.is_owner_wallet,
        is_active=True,
        is_system=False,
    )

    db.add(account)
    db.flush()

    opening = Decimal(payload.opening_balance or 0)
    if opening != 0:
        accounting_service.post_opening_balance(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            wallet=account,
            amount=opening,
        )

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="WALLET",
        entity_id=account.id,
        title="Wallet Created",
        description=f"{account.name} wallet created",
    )

    db.commit()
    db.refresh(account)

    return serialize_wallet(db, account)


@router.get("/family/{family_id}", response_model=list[AccountResponse])
def list_family_accounts(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="wallet.read",
    )

    from app.repositories import account_repo

    accounts = [
        a
        for a in account_repo(db).list_active_for_family(family_id)
        if getattr(a, "is_active", True) and is_spend_wallet(a)
    ]

    out = [
        serialize_wallet(db, account)
        for account in accounts
        if can_view_wallet(member, account)
    ]
    db.commit()
    return out


@router.get("/coa/{family_id}", response_model=list[AccountResponse])
def list_chart_of_accounts(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full Chart of Accounts including INCOME/EXPENSE/LIABILITY/EQUITY."""
    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="wallet.read",
    )
    from app.services.chart_of_accounts import ensure_family_chart

    ensure_family_chart(db, family_id=family_id, owner_member_id=member.id)
    accounting_service.repair_legacy_null_account_lines(
        db, family_id=family_id, owner_member_id=member.id
    )
    db.flush()

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
            Account.is_active.is_(True),
        )
        .order_by(Account.account_type, Account.name)
        .all()
    )
    out = [
        serialize_wallet(db, a)
        for a in accounts
        if can_view_wallet(member, a) or getattr(a, "is_system", False)
    ]
    db.commit()
    return out


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.get(Account, account_id)

    if not account or account.deleted_at is not None:
        raise HTTPException(404, "Account not found")

    member = require_permission(
        db=db,
        family_id=account.family_id,
        user_id=current_user.id,
        permission="wallet.read",
    )

    if not can_view_wallet(member, account):
        raise HTTPException(403, "You do not have permission to view this wallet")

    resp = serialize_wallet(db, account)
    db.commit()
    return resp


@router.delete("/{account_id}")
def delete_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.get(Account, account_id)

    if not account or account.deleted_at is not None:
        raise HTTPException(404, "Account not found")

    member = require_permission(
        db=db,
        family_id=account.family_id,
        user_id=current_user.id,
        permission="wallet.delete",
    )

    account.is_active = False
    account.deleted_at = datetime.now(timezone.utc)

    write_audit_log(
        db=db,
        family_id=account.family_id,
        member_id=member.id,
        action_type="DELETE",
        entity_type="WALLET",
        entity_id=account.id,
        title="Wallet Deleted",
        description=f"{account.name} wallet deleted",
    )

    db.commit()

    return {
        "success": True,
        "message": "Wallet deleted",
    }