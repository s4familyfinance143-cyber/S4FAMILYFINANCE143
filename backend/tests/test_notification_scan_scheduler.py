"""Coverage for the auth-free notification scan used by Celery."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.core.database import SessionLocal
from app.main import app as _app  # noqa: F401 - imports startup schema initialization
from app.models.account import Account
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.loan import Loan
from app.models.missing_features import LoanInstallment
from app.models.notification import Notification
from app.models.user import User
from app.services.notification_scan_service import run_family_notification_scan


def _uid() -> str:
    return str(uuid4())


def test_run_family_notification_scan_creates_due_loan_installment_notification():
    db = SessionLocal()
    try:
        user = User(
            id=_uid(),
            full_name="Notification Scan Owner",
            email=f"notification-scan-{uuid4().hex[:8]}@example.com",
            password_hash="not-used-by-this-test",
            preferred_language="en",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.flush()

        family = Family(
            id=_uid(),
            name="Notification Scan Family",
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
            name="Loan Wallet",
            account_type="BANK",
            currency="BDT",
            opening_balance=Decimal("0"),
            current_balance=Decimal("0"),
            is_active=True,
        )
        db.add(account)
        db.flush()

        loan = Loan(
            id=_uid(),
            family_id=family.id,
            owner_member_id=member.id,
            wallet_account_id=account.id,
            loan_type="BORROWED",
            person_name="Test Lender",
            principal_amount=Decimal("10000"),
            paid_amount=Decimal("1000"),
            remaining_amount=Decimal("9000"),
            interest_rate=Decimal("0"),
            interest_type="NONE",
            currency="BDT",
            status="ACTIVE",
        )
        db.add(loan)
        db.flush()

        installment = LoanInstallment(
            id=_uid(),
            family_id=family.id,
            loan_id=loan.id,
            installment_no=1,
            due_date=(date.today() + timedelta(days=3)).isoformat(),
            principal_due=Decimal("1000"),
            interest_due=Decimal("0"),
            total_due=Decimal("1000"),
            paid_amount=Decimal("0"),
            status="PENDING",
        )
        db.add(installment)
        db.flush()

        result = run_family_notification_scan(db, family.id)
        db.commit()

        assert result["created_count"] >= 1
        assert result["created_ids"]
        notification = (
            db.query(Notification)
            .filter(
                Notification.family_id == family.id,
                Notification.notification_type == "LOAN_INSTALLMENT_DUE",
            )
            .one()
        )
        assert notification.id in result["created_ids"]
        assert "Test Lender" in notification.message
    finally:
        db.close()
