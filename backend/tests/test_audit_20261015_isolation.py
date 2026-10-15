"""Regression tests for the 2026-10-15 full audit.

Each test pins one finding:

- AUD-01 backup zip used to hold the whole database (every family).
- AUD-02 dashboard summary listed other members' private wallets.
- AUD-03 /accounts/balance listed other members' private wallets.
- AUD-04 sync pull returned other members' private wallets + their lines.
- AUD-05 sync push applied any entity type without the REST permission
  (e.g. a MEMBER could delete the owner's wallet or spend from another
  member's private wallet).
- AUD-06 sync permission check ignored member_permission deny overrides.
- AUD-07 sync pull cursor compared "YYYY-MM-DD HH:MM" DB text against an
  ISO "YYYY-MM-DDTHH:MM" token, so same-day changes were never pulled.
"""

from __future__ import annotations

import io
import json
import zipfile
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.core.timeutil import utc_now
from app.main import app
from app.models.account import Account
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.member_permission import MemberPermission
from app.models.transaction import Transaction
from app.models.user import User

client = TestClient(app)


def _user(db, label: str) -> User:
    user = User(
        full_name=f"Audit {label}",
        email=f"audit-{label.lower()}-{uuid4().hex[:8]}@example.com",
        password_hash="not-used",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
        is_phone_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _headers(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


def _create_family(owner_id: str, name: str) -> str:
    res = client.post(
        "/api/v1/families",
        headers=_headers(owner_id),
        json={"name": name, "default_currency": "BDT", "timezone": "Asia/Dhaka"},
    )
    assert res.status_code in {200, 201}, res.text
    body = res.json()
    family_id = body.get("family_id") or body.get("id") or (body.get("family") or {}).get("id")
    assert family_id
    return family_id


@pytest.fixture()
def fam():
    """OWNER + MEMBER-A + MEMBER-B; MEMBER-A holds a private wallet."""
    db = SessionLocal()
    try:
        owner = _user(db, "Owner")
        a = _user(db, "MemberA")
        b = _user(db, "MemberB")
        db.commit()
        ids = {"owner": owner.id, "a": a.id, "b": b.id}
    finally:
        db.close()

    family_id = _create_family(ids["owner"], f"Audit Fam {uuid4().hex[:6]}")

    db = SessionLocal()
    try:
        ma = FamilyMember(family_id=family_id, user_id=ids["a"], role="MEMBER", status="ACTIVE")
        mb = FamilyMember(family_id=family_id, user_id=ids["b"], role="MEMBER", status="ACTIVE")
        db.add_all([ma, mb])
        db.flush()
        private = Account(
            family_id=family_id,
            owner_member_id=ma.id,
            name=f"A-Private-{uuid4().hex[:6]}",
            account_type="CASH",
            currency="BDT",
            opening_balance=Decimal("0"),
            current_balance=Decimal("0"),
            is_shared_family=False,
            is_owner_wallet=False,
            is_active=True,
        )
        db.add(private)
        db.commit()
        category = (
            db.query(Category)
            .filter(Category.family_id == family_id, Category.category_type == "EXPENSE")
            .first()
        )
        data = {
            **ids,
            "family_id": family_id,
            "member_a_id": ma.id,
            "member_b_id": mb.id,
            "private_wallet_id": private.id,
            "private_wallet_name": private.name,
            "expense_category_id": category.id if category else None,
        }
    finally:
        # Close before the test body runs: an open SQLite read transaction
        # here would block every API write the test makes.
        db.close()
    yield data


def _push(user_id: str, family_id: str, changes: list[dict]):
    return client.post(
        f"/api/v1/families/{family_id}/sync/push",
        headers=_headers(user_id),
        json={"device_id": f"dev-{uuid4().hex[:6]}", "changes": changes},
    )


def _pull(user_id: str, family_id: str, since: str | None = None):
    params = {"device_id": "audit-dev", "limit": 500}
    if since:
        params["since_token"] = since
    res = client.get(f"/api/v1/families/{family_id}/sync/pull", headers=_headers(user_id), params=params)
    assert res.status_code == 200, res.text
    return res.json()


def _deposit_into_private_wallet(fam: dict) -> None:
    """Give MEMBER-A's private wallet journal activity through the real API."""
    db = SessionLocal()
    try:
        income_cat = (
            db.query(Category)
            .filter(Category.family_id == fam["family_id"], Category.category_type == "INCOME")
            .first()
        )
        assert income_cat is not None
        cat_id = income_cat.id
    finally:
        db.close()
    res = client.post(
        "/api/v1/transactions/income",
        headers=_headers(fam["a"]),
        json={
            "family_id": fam["family_id"],
            "account_id": fam["private_wallet_id"],
            "category_id": cat_id,
            "amount": "500.00",
            "currency": "BDT",
            "description": "private income",
        },
    )
    assert res.status_code in {200, 201}, res.text


# --------------------------------------------------------------------------- AUD-01


def test_aud01_backup_zip_holds_only_requesting_family(fam):
    db = SessionLocal()
    try:
        other_owner = _user(db, "OtherOwner")
        db.commit()
        other_owner_id = other_owner.id
    finally:
        db.close()
    other_family = _create_family(other_owner_id, f"Other Fam {uuid4().hex[:6]}")

    created = client.post(f"/api/v1/backup/create/{other_family}", headers=_headers(other_owner_id))
    assert created.status_code == 200, created.text
    file_name = created.json()["backup_file"]

    dl = client.get(f"/api/v1/backup/download/{other_family}/{file_name}", headers=_headers(other_owner_id))
    assert dl.status_code == 200, dl.text

    with zipfile.ZipFile(io.BytesIO(dl.content)) as zf:
        blob = b"".join(zf.read(n) for n in zf.namelist())
    assert fam["family_id"].encode() not in blob
    assert fam["private_wallet_name"].encode() not in blob
    assert b"password_hash" not in blob
    assert other_family.encode() in blob


# --------------------------------------------------------------------------- AUD-02


def test_aud02_dashboard_hides_other_members_private_wallet(fam):
    res_b = client.get(f"/api/v1/dashboard/{fam['family_id']}", headers=_headers(fam["b"]))
    assert res_b.status_code == 200, res_b.text
    names_b = {w["name"] for w in res_b.json()["wallets"]}
    assert fam["private_wallet_name"] not in names_b

    res_a = client.get(f"/api/v1/dashboard/{fam['family_id']}", headers=_headers(fam["a"]))
    assert res_a.status_code == 200, res_a.text
    names_a = {w["name"] for w in res_a.json()["wallets"]}
    assert fam["private_wallet_name"] in names_a


def test_aud02_dashboard_wallet_total_matches_visible_wallets(fam):
    _deposit_into_private_wallet(fam)
    res_b = client.get(f"/api/v1/dashboard/{fam['family_id']}", headers=_headers(fam["b"])).json()
    visible_total = sum((Decimal(w["balance"]) for w in res_b["wallets"]), Decimal("0"))
    assert Decimal(res_b["summary"]["total_wallet_balance"]) == visible_total


def test_aud02_dashboard_total_excludes_system_ledger_accounts(fam):
    """One income of 500 must raise the wallet total by 500, not 1000
    (the wallet leg plus the "... Income" ledger account leg)."""
    _deposit_into_private_wallet(fam)
    wallets = client.get(f"/api/v1/accounts/family/{fam['family_id']}", headers=_headers(fam["owner"]))
    assert wallets.status_code == 200, wallets.text
    expected = sum((Decimal(w["current_balance"]) for w in wallets.json()), Decimal("0"))

    for path in ("", "/full-currency"):
        res = client.get(f"/api/v1/dashboard/{fam['family_id']}{path}", headers=_headers(fam["owner"]))
        assert res.status_code == 200, res.text
        assert Decimal(res.json()["summary"]["total_wallet_balance"]) == expected, path
    nw = client.get(f"/api/v1/dashboard/{fam['family_id']}/networth-currency", headers=_headers(fam["owner"]))
    assert Decimal(nw.json()["summary"]["wallet_balance"]) == expected
    cur = client.get(f"/api/v1/dashboard/{fam['family_id']}/currency", headers=_headers(fam["owner"]))
    assert Decimal(cur.json()["total_balance"]) == expected


# --------------------------------------------------------------------------- AUD-03


def test_aud03_accounts_balance_hides_other_members_private_wallet(fam):
    res = client.get(
        "/api/v1/accounts/balance", headers=_headers(fam["b"]), params={"family_id": fam["family_id"]}
    )
    assert res.status_code == 200, res.text
    ids = {r["account_id"] for r in res.json()["accounts"]}
    assert fam["private_wallet_id"] not in ids

    res_a = client.get(
        "/api/v1/accounts/balance", headers=_headers(fam["a"]), params={"family_id": fam["family_id"]}
    )
    assert fam["private_wallet_id"] in {r["account_id"] for r in res_a.json()["accounts"]}


# --------------------------------------------------------------------------- AUD-04


def test_aud04_sync_pull_hides_other_members_private_wallet_and_lines(fam):
    _deposit_into_private_wallet(fam)

    body_b = _pull(fam["b"], fam["family_id"])
    account_ids = {r["id"] for r in body_b["changes"]["accounts"]}
    assert fam["private_wallet_id"] not in account_ids
    line_accounts = {r.get("account_id") for r in body_b["changes"]["transaction_lines"]}
    assert fam["private_wallet_id"] not in line_accounts

    body_a = _pull(fam["a"], fam["family_id"])
    assert fam["private_wallet_id"] in {r["id"] for r in body_a["changes"]["accounts"]}


# --------------------------------------------------------------------------- AUD-05


def test_aud05_member_cannot_delete_another_wallet_via_sync(fam):
    res = _push(
        fam["b"],
        fam["family_id"],
        [{"entity_type": "accounts", "operation": "DELETE", "entity_id": fam["private_wallet_id"],
          "client_change_id": uuid4().hex, "payload": {}}],
    )
    assert res.status_code == 200, res.text
    db = SessionLocal()
    try:
        row = db.get(Account, fam["private_wallet_id"])
        assert row.deleted_at is None
        assert row.is_active is True
    finally:
        db.close()


def test_aud05_member_cannot_unhide_private_wallet_via_sync(fam):
    _push(
        fam["b"],
        fam["family_id"],
        [{"entity_type": "accounts", "operation": "UPDATE", "entity_id": fam["private_wallet_id"],
          "client_change_id": uuid4().hex, "payload": {"is_shared_family": True}}],
    )
    db = SessionLocal()
    try:
        assert db.get(Account, fam["private_wallet_id"]).is_shared_family is False
    finally:
        db.close()


def test_aud05_member_cannot_spend_from_another_members_private_wallet_via_sync(fam):
    _deposit_into_private_wallet(fam)
    crid = f"aud05-{uuid4().hex}"
    res = _push(
        fam["b"],
        fam["family_id"],
        [{"entity_type": "transactions", "operation": "CREATE", "client_change_id": crid,
          "payload": {"transaction_type": "EXPENSE", "account_id": fam["private_wallet_id"],
                      "category_id": fam["expense_category_id"], "amount": "100.00",
                      "currency": "BDT", "client_request_id": crid}}],
    )
    assert res.status_code == 200, res.text
    db = SessionLocal()
    try:
        tx = (
            db.query(Transaction)
            .filter(Transaction.family_id == fam["family_id"], Transaction.client_request_id == crid)
            .first()
        )
        assert tx is None
    finally:
        db.close()


def test_aud05_member_can_still_spend_from_shared_wallet_via_sync(fam):
    db = SessionLocal()
    try:
        shared = (
            db.query(Account)
            .filter(
                Account.family_id == fam["family_id"],
                Account.is_shared_family.is_(True),
                Account.is_system.is_(False),
                Account.account_type == "CASH",
                Account.deleted_at.is_(None),
            )
            .first()
        )
        assert shared is not None
        shared_id = shared.id
    finally:
        db.close()
    # fund it so the expense does not fail on balance
    res = client.post(
        "/api/v1/transactions/income",
        headers=_headers(fam["owner"]),
        json={"family_id": fam["family_id"], "account_id": shared_id,
              "category_id": _income_category(fam["family_id"]), "amount": "300.00", "currency": "BDT"},
    )
    assert res.status_code in {200, 201}, res.text

    crid = f"aud05ok-{uuid4().hex}"
    res = _push(
        fam["b"],
        fam["family_id"],
        [{"entity_type": "transactions", "operation": "CREATE", "client_change_id": crid,
          "payload": {"transaction_type": "EXPENSE", "account_id": shared_id,
                      "category_id": fam["expense_category_id"], "amount": "10.00",
                      "currency": "BDT", "client_request_id": crid}}],
    )
    assert res.status_code == 200, res.text
    assert res.json()["applied"]["synced_count"] == 1, res.text


def _shared_cash_wallet(family_id: str) -> str:
    db = SessionLocal()
    try:
        return (
            db.query(Account)
            .filter(
                Account.family_id == family_id,
                Account.is_shared_family.is_(True),
                Account.is_system.is_(False),
                Account.account_type == "CASH",
                Account.deleted_at.is_(None),
            )
            .first()
            .id
        )
    finally:
        db.close()


def _loan_change(wallet_id: str) -> dict:
    return {
        "entity_type": "loans",
        "operation": "CREATE",
        "client_change_id": uuid4().hex,
        "payload": {"loan_type": "TAKEN", "person_name": "Lender", "principal_amount": "100",
                    "currency": "BDT", "wallet_account_id": wallet_id},
    }


def _loan_count(family_id: str) -> int:
    from app.models.loan import Loan

    db = SessionLocal()
    try:
        return db.query(Loan).filter(Loan.family_id == family_id).count()
    finally:
        db.close()


def test_aud05_member_cannot_create_loan_via_sync(fam):
    wallet_id = _shared_cash_wallet(fam["family_id"])
    res = _push(fam["b"], fam["family_id"], [_loan_change(wallet_id)])
    assert res.status_code == 200, res.text
    assert _loan_count(fam["family_id"]) == 0
    assert res.json()["applied"]["failed_count"] == 1

    # control: the owner holds loan.create, so the same change applies
    ok = _push(fam["owner"], fam["family_id"], [_loan_change(wallet_id)])
    assert ok.json()["applied"]["synced_count"] == 1, ok.text
    assert _loan_count(fam["family_id"]) == 1


def test_aud10_failed_sync_change_leaves_no_partial_rows(fam, monkeypatch):
    """loans CREATE flushes the Loan row before posting the ledger entry; a
    posting failure returned FAILED but the push still committed the orphan
    Loan (debt shown, no journal behind it)."""
    from app.services import accounting_service

    def boom(*args, **kwargs):
        raise RuntimeError("ledger down")

    monkeypatch.setattr(accounting_service, "post_loan_taken", boom)
    wallet_id = _shared_cash_wallet(fam["family_id"])
    res = _push(fam["owner"], fam["family_id"], [_loan_change(wallet_id)])
    assert res.status_code == 200, res.text
    assert res.json()["applied"]["failed_count"] == 1
    assert _loan_count(fam["family_id"]) == 0


def _income_category(family_id: str) -> str:
    db = SessionLocal()
    try:
        return (
            db.query(Category)
            .filter(Category.family_id == family_id, Category.category_type == "INCOME")
            .first()
            .id
        )
    finally:
        db.close()


# --------------------------------------------------------------------------- AUD-06


def test_aud06_sync_push_honours_deny_override(fam):
    db = SessionLocal()
    try:
        db.add(MemberPermission(member_id=fam["member_b_id"], permission_key="transaction.create", allow=False))
        db.commit()
    finally:
        db.close()
    res = _push(fam["b"], fam["family_id"], [])
    assert res.status_code == 403, res.text


def test_aud06_sync_rejects_non_active_member(fam):
    db = SessionLocal()
    try:
        m = db.get(FamilyMember, fam["member_b_id"])
        m.status = "PENDING"
        db.commit()
    finally:
        db.close()
    res = client.get(
        f"/api/v1/families/{fam['family_id']}/sync/pull", headers=_headers(fam["b"]), params={"device_id": "x"}
    )
    assert res.status_code == 403, res.text


# --------------------------------------------------------------------------- AUD-07


def test_aud07_sync_pull_returns_same_day_changes_after_token(fam):
    first = _pull(fam["owner"], fam["family_id"])
    token = first["sync_token"]

    db = SessionLocal()
    try:
        row = db.get(Account, fam["private_wallet_id"])
        row.name = f"{row.name}-renamed"
        row.updated_at = utc_now()
        db.commit()
    finally:
        db.close()

    second = _pull(fam["owner"], fam["family_id"], since=token)
    ids = {r["id"] for r in second["changes"]["accounts"]}
    assert fam["private_wallet_id"] in ids


def test_aud07_sync_pull_serializes_money_as_string(fam):
    _deposit_into_private_wallet(fam)
    body = _pull(fam["a"], fam["family_id"])
    tx_amounts = [r["amount"] for r in body["changes"]["transactions"]]
    assert tx_amounts
    assert all(isinstance(v, str) for v in tx_amounts)
    json.dumps(body)


# --------------------------------------------------------------------------- AUD-08


def test_aud08_contract_wrappers_pass_all_query_params(fam):
    """Endpoint functions called directly used to receive Query() objects for
    parameters the wrapper did not pass (limit / start_date / end_date)."""
    pull = client.get(
        "/api/v1/sync/pull", headers=_headers(fam["owner"]), params={"family_id": fam["family_id"]}
    )
    assert pull.status_code == 200, pull.text
    cash = client.get(
        "/api/v1/reports/cashflow", headers=_headers(fam["owner"]), params={"family_id": fam["family_id"]}
    )
    assert cash.status_code == 200, cash.text


# --------------------------------------------------------------------------- SYNC-1 / SYNC-2


def test_sync_same_change_pushed_twice_creates_one_outbox_row(fam):
    from sqlalchemy import text

    change_id = uuid4().hex
    entity_id = str(uuid4())
    change = {"entity_type": "grocery_lists", "operation": "CREATE", "entity_id": entity_id,
              "client_change_id": change_id, "payload": {"title": "Weekly"}}
    body = {"device_id": "mobile-expo", "changes": [change]}
    first = client.post(f"/api/v1/families/{fam['family_id']}/sync/push", headers=_headers(fam["owner"]), json=body)
    second = client.post(f"/api/v1/families/{fam['family_id']}/sync/push", headers=_headers(fam["owner"]), json=body)
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert first.json()["accepted_outbox_ids"] == second.json()["accepted_outbox_ids"]
    db = SessionLocal()
    try:
        n = db.execute(
            text("SELECT COUNT(*) FROM sync_outbox WHERE family_id = :f AND client_change_id = :c"),
            {"f": fam["family_id"], "c": change_id},
        ).scalar()
        assert n == 1
    finally:
        db.close()


def test_sync_state_is_per_member_even_with_shared_device_id(fam):
    """Clients send a fixed device id ("mobile-expo"); members must not share
    one sync_state row."""
    from sqlalchemy import text

    for user in ("owner", "a"):
        res = client.get(
            f"/api/v1/families/{fam['family_id']}/sync/pull",
            headers=_headers(fam[user]),
            params={"device_id": "mobile-expo"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["device_id"] == "mobile-expo"
    db = SessionLocal()
    try:
        n = db.execute(
            text("SELECT COUNT(*) FROM sync_state WHERE family_id = :f"), {"f": fam["family_id"]}
        ).scalar()
        assert n == 2
    finally:
        db.close()
