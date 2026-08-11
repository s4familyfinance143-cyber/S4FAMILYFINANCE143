"""Seed default wallets + categories when a family is created."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.api.v1.categories import DEFAULT_CATEGORIES
from app.models.account import Account
from app.models.category import Category
from app.models.relationship_type import RelationshipType
from app.services.chart_of_accounts import ensure_family_chart
from app.services.relationship_rules import RELATIONSHIP_GROUPS


DEFAULT_ACCOUNTS = [
    {"name": "Cash", "account_type": "CASH"},
    {"name": "Bank", "account_type": "BANK"},
    {"name": "bKash", "account_type": "BKASH"},
    {"name": "Nagad", "account_type": "NAGAD"},
    {"name": "Rocket", "account_type": "ROCKET"},
    {"name": "Card", "account_type": "CARD"},
    {"name": "Gold", "account_type": "GOLD"},
    {"name": "Asset", "account_type": "ASSET"},
]

BN_LABELS = {
    "Husband": "স্বামী",
    "Wife": "স্ত্রী",
    "Son": "ছেলে",
    "Daughter": "মেয়ে",
    "Son's Wife": "পুত্রবধূ",
    "Daughter's Husband": "জামাই",
    "Father": "বাবা",
    "Mother": "মা",
    "Brother": "ভাই",
    "Sister": "বোন",
    "Elder Brother": "বড় ভাই",
    "Elder Sister": "বড় বোন",
    "Guardian": "অভিভাবক",
    "Relative": "আত্মীয়",
    "Other": "অন্যান্য",
}


def seed_relationship_types(db: Session) -> int:
    created = 0
    serial_groups = {"CHILDREN", "SIBLINGS"}
    for group, labels in RELATIONSHIP_GROUPS.items():
        for name_en in labels:
            exists = (
                db.query(RelationshipType)
                .filter(RelationshipType.name_en == name_en)
                .first()
            )
            if exists:
                continue
            db.add(
                RelationshipType(
                    name_en=name_en,
                    name_bn=BN_LABELS.get(name_en, name_en),
                    group_name=group,
                    needs_serial=group in serial_groups,
                    is_system=True,
                    is_active=True,
                )
            )
            created += 1
    if created:
        db.flush()
    return created


def seed_family_defaults(db: Session, *, family_id: str, owner_member_id: str) -> dict:
    accounts_created = 0
    categories_created = 0
    relationships_created = seed_relationship_types(db)

    for item in DEFAULT_ACCOUNTS:
        exists = (
            db.query(Account)
            .filter(
                Account.family_id == family_id,
                Account.name == item["name"],
                Account.deleted_at.is_(None),
            )
            .first()
        )
        if exists:
            continue
        db.add(
            Account(
                family_id=family_id,
                owner_member_id=owner_member_id,
                name=item["name"],
                account_type=item["account_type"],
                opening_balance=Decimal("0"),
                current_balance=Decimal("0"),
                currency="BDT",
                is_shared_family=True,
                is_owner_wallet=item["account_type"] == "CASH",
                is_active=True,
            )
        )
        accounts_created += 1

    for item in DEFAULT_CATEGORIES:
        exists = (
            db.query(Category)
            .filter(
                Category.family_id == family_id,
                Category.name_en == item["name_en"],
                Category.category_type == item["category_type"],
                Category.deleted_at.is_(None),
            )
            .first()
        )
        if exists:
            continue
        db.add(
            Category(
                family_id=family_id,
                name_bn=item["name_bn"],
                name_en=item["name_en"],
                category_type=item["category_type"],
                icon=item["icon"],
                color=item["color"],
                is_system=True,
                is_active=True,
            )
        )
        categories_created += 1

    ensure_family_chart(
        db,
        family_id=family_id,
        owner_member_id=owner_member_id,
        currency="BDT",
    )

    db.flush()
    return {
        "accounts_created": accounts_created,
        "categories_created": categories_created,
        "relationships_created": relationships_created,
    }
