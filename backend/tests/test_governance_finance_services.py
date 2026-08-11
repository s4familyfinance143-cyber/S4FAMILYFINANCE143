"""Family bootstrap + join expire + void reverse — real service coverage."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.account import Account
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.invite_code import InviteCode
from app.models.join_request import JoinRequest
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.services.family_bootstrap import DEFAULT_ACCOUNTS, seed_family_defaults
from app.services.join_request_service import expire_stale_join_requests
from app.services.transaction_void_service import (
    reverse_account_balances_from_lines,
    void_posted_transaction,
)


def _uid() -> str:
    return str(uuid4())


def test_seed_family_defaults_creates_wallets_and_categories():
    db = SessionLocal()
    try:
        user = User(
            id=_uid(),
            full_name="Seed Owner",
            email=f"seed-{_uid()[:8]}@s4family.com",
            password_hash=hash_password("SeedPass1!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.flush()
        family = Family(
            id=_uid(),
            name="Seed Family",
            owner_user_id=user.id,
            default_currency="BDT",
            timezone="Asia/Dhaka",
            is_active=True,
        )
        db.add(family)
        db.flush()
        member = FamilyMember(
            id=_uid(),
            family_id=family.id,
            user_id=user.id,
            role="OWNER",
            status="ACTIVE",
        )
        db.add(member)
        db.flush()

        result = seed_family_defaults(db, family_id=family.id, owner_member_id=member.id)
        db.commit()

        assert result["accounts_created"] >= len(DEFAULT_ACCOUNTS)
        assert result["categories_created"] >= 1
        accounts = (
            db.query(Account)
            .filter(Account.family_id == family.id, Account.deleted_at.is_(None))
            .all()
        )
        types = {a.account_type for a in accounts}
        for needed in ("CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "GOLD", "ASSET"):
            assert needed in types
    finally:
        db.close()


def test_expire_stale_join_requests_marks_expired_invite():
    db = SessionLocal()
    try:
        user = User(
            id=_uid(),
            full_name="Join User",
            email=f"join-{_uid()[:8]}@s4family.com",
            password_hash=hash_password("JoinPass1!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        owner = User(
            id=_uid(),
            full_name="Owner User",
            email=f"own-{_uid()[:8]}@s4family.com",
            password_hash=hash_password("OwnPass1!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add_all([user, owner])
        db.flush()
        family = Family(
            id=_uid(),
            name="Join Family",
            owner_user_id=owner.id,
            default_currency="BDT",
            timezone="Asia/Dhaka",
            is_active=True,
        )
        db.add(family)
        db.flush()
        owner_member = FamilyMember(
            id=_uid(),
            family_id=family.id,
            user_id=owner.id,
            role="OWNER",
            status="ACTIVE",
        )
        db.add(owner_member)
        db.flush()
        invite = InviteCode(
            id=_uid(),
            family_id=family.id,
            code_hash=f"hash-{_uid()}",
            created_by_member_id=owner_member.id,
            status="REVOKED",
            max_uses=1,
            used_count=0,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(invite)
        db.flush()
        jr = JoinRequest(
            id=_uid(),
            family_id=family.id,
            user_id=user.id,
            invite_code_id=invite.id,
            status="PENDING",
            requested_role="MEMBER",
        )
        db.add(jr)
        db.commit()

        changed = expire_stale_join_requests(db, family.id)
        assert changed >= 1
        db.refresh(jr)
        assert jr.status == "EXPIRED"
    finally:
        db.close()


def test_void_reverses_account_balance():
    db = SessionLocal()
    try:
        user = User(
            id=_uid(),
            full_name="Void Owner",
            email=f"void-{_uid()[:8]}@s4family.com",
            password_hash=hash_password("VoidPass1!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.flush()
        family = Family(
            id=_uid(),
            name="Void Family",
            owner_user_id=user.id,
            default_currency="BDT",
            timezone="Asia/Dhaka",
            is_active=True,
        )
        db.add(family)
        db.flush()
        member = FamilyMember(
            id=_uid(),
            family_id=family.id,
            user_id=user.id,
            role="OWNER",
            status="ACTIVE",
        )
        db.add(member)
        db.flush()
        account = Account(
            id=_uid(),
            family_id=family.id,
            owner_member_id=member.id,
            name="Cash",
            account_type="CASH",
            opening_balance=Decimal("0"),
            current_balance=Decimal("1000"),
            currency="BDT",
            is_shared_family=True,
            is_active=True,
        )
        db.add(account)
        db.flush()
        tx = Transaction(
            id=_uid(),
            family_id=family.id,
            created_by_member_id=member.id,
            transaction_type="INCOME",
            amount=Decimal("1000"),
            currency="BDT",
            description="Seed income",
            status="POSTED",
        )
        db.add(tx)
        db.flush()
        line = TransactionLine(
            id=_uid(),
            transaction_id=tx.id,
            account_id=account.id,
            line_type="ASSET",
            debit=Decimal("1000"),
            credit=Decimal("0"),
        )
        db.add(line)
        db.commit()

        db.refresh(account)
        assert Decimal(account.current_balance) == Decimal("1000")

        result = void_posted_transaction(db, tx=tx, member_id=member.id, reason="test void")
        db.commit()
        db.refresh(account)
        db.refresh(tx)

        assert result["status"] == "VOID"
        assert result["lines_reversed"] == 1
        assert Decimal(account.current_balance) == Decimal("0")
        assert str(tx.status).upper() == "VOID"
    finally:
        db.close()


def test_reverse_helper_is_idempotent_math():
    """Debit 200 + credit 50 on balance 500 → reverse leaves 350."""
    db = SessionLocal()
    try:
        user = User(
            id=_uid(),
            full_name="Math Owner",
            email=f"math-{_uid()[:8]}@s4family.com",
            password_hash=hash_password("MathPass1!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.flush()
        family = Family(
            id=_uid(),
            name="Math Family",
            owner_user_id=user.id,
            default_currency="BDT",
            timezone="Asia/Dhaka",
            is_active=True,
        )
        db.add(family)
        db.flush()
        member = FamilyMember(
            id=_uid(),
            family_id=family.id,
            user_id=user.id,
            role="OWNER",
            status="ACTIVE",
        )
        db.add(member)
        db.flush()
        account = Account(
            id=_uid(),
            family_id=family.id,
            owner_member_id=member.id,
            name="Bank",
            account_type="BANK",
            opening_balance=Decimal("0"),
            current_balance=Decimal("500"),
            currency="BDT",
            is_shared_family=True,
            is_active=True,
        )
        db.add(account)
        db.flush()
        line = TransactionLine(
            id=_uid(),
            transaction_id=_uid(),
            account_id=account.id,
            line_type="ASSET",
            debit=Decimal("200"),
            credit=Decimal("50"),
        )
        # Don't persist orphan line FK if required — attach to minimal tx
        tx = Transaction(
            id=line.transaction_id,
            family_id=family.id,
            created_by_member_id=member.id,
            transaction_type="TRANSFER",
            amount=Decimal("150"),
            currency="BDT",
            description="math",
            status="POSTED",
        )
        db.add(tx)
        db.flush()
        db.add(line)
        db.commit()

        n = reverse_account_balances_from_lines(db, [line])
        db.commit()
        db.refresh(account)
        assert n == 1
        assert Decimal(account.current_balance) == Decimal("350")
    finally:
        db.close()
