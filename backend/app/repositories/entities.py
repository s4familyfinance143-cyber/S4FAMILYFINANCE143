from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.family import Family
from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    def get_by_email(self, email: str) -> User | None:
        return (
            self.db.query(User)
            .filter(User.email == email.strip().lower(), User.deleted_at.is_(None))
            .first()
        )


class FamilyRepository(BaseRepository[Family]):
    model = Family

    def list_active_for_user(self, user_id: str) -> list[Family]:
        from app.models.family_member import FamilyMember

        return (
            self.db.query(Family)
            .join(FamilyMember, FamilyMember.family_id == Family.id)
            .filter(
                FamilyMember.user_id == user_id,
                FamilyMember.deleted_at.is_(None),
                Family.deleted_at.is_(None),
                Family.is_active.is_(True),
            )
            .all()
        )


def user_repo(db: Session) -> UserRepository:
    return UserRepository(db)


def family_repo(db: Session) -> FamilyRepository:
    return FamilyRepository(db)


class AccountRepository(BaseRepository):
    def __init__(self, db: Session):
        from app.models.account import Account

        self.model = Account
        super().__init__(db)

    def list_active_for_family(self, family_id: str):
        return (
            self.db.query(self.model)
            .filter(
                self.model.family_id == family_id,
                self.model.deleted_at.is_(None),
            )
            .all()
        )


class TransactionRepository(BaseRepository):
    def __init__(self, db: Session):
        from app.models.transaction import Transaction

        self.model = Transaction
        super().__init__(db)

    def list_for_family(self, family_id: str, limit: int = 50):
        return (
            self.db.query(self.model)
            .filter(
                self.model.family_id == family_id,
                self.model.deleted_at.is_(None),
            )
            .order_by(self.model.created_at.desc())
            .limit(limit)
            .all()
        )


def account_repo(db: Session) -> AccountRepository:
    return AccountRepository(db)


def transaction_repo(db: Session) -> TransactionRepository:
    return TransactionRepository(db)
