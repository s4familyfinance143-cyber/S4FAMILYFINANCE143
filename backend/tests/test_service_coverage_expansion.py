"""Fast unit tests for high-line service modules without external services."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.core import rate_limit
from app.core import field_encryption
from app.core.errors import register_exception_handlers
from app.services import accounting_service as accounting
from app.services import architecture_readiness_service, finance_posting, job_queue
from app.services import chart_of_accounts as coa
from app.services import email_service, fcm_service, notification_delivery_service, permission_service
from app.utils import currency, date_helper


class Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None


class Db:
    def __init__(self, query_rows=(), got=None):
        self.query_rows = list(query_rows)
        self.got = got
        self.added = []
        self.flush_count = 0
        self.commit_count = 0

    def query(self, *models):
        rows = self.query_rows.pop(0) if self.query_rows else []
        return Query(rows)

    def get(self, model, key):
        return self.got

    def add(self, value):
        self.added.append(value)

    def flush(self):
        self.flush_count += 1
        for value in self.added:
            if getattr(value, "id", None) is None:
                value.id = f"id-{len(self.added)}"

    def commit(self):
        self.commit_count += 1

    def refresh(self, value):
        value.refreshed = True


@pytest.mark.parametrize(
    ("raw", "normalized", "ledger", "wallet"),
    [
        (" loan_payable ", "LIABILITY", "LIABILITY", False),
        ("mobile_banking", "MOBILE", "ASSET", True),
        ("expense", "EXPENSE", "EXPENSE", False),
        ("unknown", "UNKNOWN", "ASSET", False),
        (None, "", "ASSET", False),
    ],
)
def test_chart_type_helpers(raw, normalized, ledger, wallet):
    assert coa.normalize_account_type(raw) == normalized
    assert coa.ledger_class(raw) == ledger
    assert coa.is_wallet_type(raw) is wallet


def test_spend_wallet_and_ensure_accounts(monkeypatch):
    assert coa.is_spend_wallet(SimpleNamespace(is_system=False, name="Cash", account_type="CASH"))
    assert not coa.is_spend_wallet(
        SimpleNamespace(is_system=True, name="Cash", account_type="CASH")
    )
    assert not coa.is_spend_wallet(
        SimpleNamespace(is_system=False, name="Opening Equity", account_type="ASSET")
    )

    monkeypatch.setattr(coa, "_ensure_is_system_column", lambda db: None)
    existing = SimpleNamespace(account_type="LOAN_PAYABLE", is_system=False)
    assert (
        coa.ensure_system_account(
            Db([[existing]]),
            family_id="f",
            owner_member_id="m",
            name="Loan",
            account_type="LOAN_PAYABLE",
        )
        is existing
    )
    assert existing.account_type == "LIABILITY"
    assert existing.is_system is True

    db = Db([[]])
    made = coa.ensure_system_account(
        db,
        family_id="f",
        owner_member_id="m",
        name="Custom",
        account_type="mystery",
        currency=" usd ",
    )
    assert made.account_type == "ASSET"
    assert made.currency == "USD"
    assert db.flush_count == 1


def test_ensure_family_chart_and_named_account(monkeypatch):
    calls = []

    def ensure(db, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(name=kwargs["name"])

    monkeypatch.setattr(coa, "ensure_system_account", ensure)
    chart = coa.ensure_family_chart(Db(), family_id="f", owner_member_id="m", currency="USD")
    assert set(chart) == {spec["key"] for spec in coa.SYSTEM_ACCOUNT_SPECS}
    assert len(calls) == len(coa.SYSTEM_ACCOUNT_SPECS)

    existing = SimpleNamespace(account_type="ASSET", is_system=False)
    result = coa.ensure_named_coa_account(
        Db([[existing]]),
        family_id="f",
        owner_member_id="m",
        name=" Salary ",
        account_type="INCOME",
    )
    assert result is existing
    assert result.account_type == "INCOME"
    assert result.is_system

    calls.clear()
    coa.ensure_named_coa_account(
        Db([[]]), family_id="f", owner_member_id="m", name="", account_type="INCOME"
    )
    assert calls[0]["name"] == "Other Income"


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        (None, "MEMBER"),
        ("family_owner", "OWNER"),
        ("admin", "ADMIN"),
        ("viewer", "VIEWER"),
        ("daughter", "CHILD"),
        ("wife", "MEMBER"),
        ("unexpected", "MEMBER"),
    ],
)
def test_permission_role_helpers(role, expected):
    assert permission_service.normalize_role(role) == expected
    assert permission_service.get_base_permissions(role) == sorted(
        permission_service.PERMISSIONS[expected]
    )


def test_permission_overrides_and_guards():
    merged = permission_service.merge_permission_overrides(
        ["a", "b"], extra_permissions=["c"], denied_permissions=["b"]
    )
    assert merged == ["a", "c"]
    overrides = [
        SimpleNamespace(permission_key="x", allow=False),
        SimpleNamespace(permission_key="x", allow=True),
        SimpleNamespace(permission_key="y", allow=False),
    ]
    assert permission_service.member_permission_override_map(overrides) == {"x": True, "y": False}

    owner = SimpleNamespace(id="o", role="OWNER")
    db = Db([overrides])
    effective = permission_service.effective_permission_keys(db, owner)
    assert "x" in effective and "member.permission" in effective

    member = SimpleNamespace(id="m", role="MEMBER")
    db = Db([[member], [SimpleNamespace(permission_key="wallet.read", allow=False)]])
    with pytest.raises(HTTPException, match="Permission denied"):
        permission_service.require_permission(db, "f", "u", "wallet.read")

    with pytest.raises(HTTPException, match="active family member"):
        permission_service.get_active_member_or_403(Db([[]]), "f", "u")
    with pytest.raises(HTTPException, match="Owner permission"):
        permission_service.require_owner(Db([[member]]), "f", "u")
    assert permission_service.require_owner(Db([[owner]]), "f", "u") is owner
    assert permission_service.require_owner_or_admin(
        Db([[SimpleNamespace(role="ADMIN")]]), "f", "u"
    ).role == "ADMIN"
    with pytest.raises(HTTPException, match="Owner or Admin"):
        permission_service.require_owner_or_admin(Db([[member]]), "f", "u")
    assert permission_service.has_permission(member, "wallet.read")


def test_account_balance_paths_and_cache():
    account = SimpleNamespace(
        id="a",
        family_id="f",
        deleted_at=None,
        opening_balance=Decimal("10"),
        current_balance=0,
        account_type="CASH",
    )
    assert accounting.calculate_account_balance(Db([[]], account), "a", family_id="f") == Decimal(
        "10.0000"
    )
    line = SimpleNamespace(debit=5, credit=2)
    tx = SimpleNamespace(transaction_type="OTHER")
    assert accounting.calculate_account_balance(
        Db([[(line, tx)]], account), "a", family_id="f"
    ) == Decimal("13.0000")
    tx.transaction_type = "OPENING_BALANCE"
    assert accounting.calculate_account_balance(
        Db([[(line, tx)]], account), "a", family_id="f"
    ) == Decimal("3.0000")
    account.account_type = "LIABILITY"
    assert accounting.calculate_account_balance(
        Db([[(line, tx)]], account), "a", family_id="f"
    ) == Decimal("-3.0000")
    account.deleted_at = "gone"
    with pytest.raises(HTTPException, match="Account not found"):
        accounting.calculate_account_balance(Db(got=account), "a")


def test_accounting_reports(monkeypatch):
    accounts = [
        SimpleNamespace(id="cash", name="Cash", account_type="CASH", currency="BDT"),
        SimpleNamespace(id="debt", name="Debt", account_type="LIABILITY", currency="BDT"),
        SimpleNamespace(id="zero", name="Zero", account_type="ASSET", currency="USD"),
    ]
    balances = {"cash": Decimal("10"), "debt": Decimal("-3"), "zero": Decimal("0")}
    monkeypatch.setattr(
        accounting, "calculate_account_balance", lambda db, aid, family_id=None: balances[aid]
    )
    trial = accounting.generate_trial_balance(Db([accounts]), "f")
    assert len(trial["rows"]) == 2
    assert trial["debit_total"] == "13"

    pnl_accounts = [
        SimpleNamespace(id="i", name="Salary", account_type="INCOME", currency="BDT"),
        SimpleNamespace(id="e", name="Food", account_type="EXPENSE", currency="BDT"),
        SimpleNamespace(id="a", name="Cash", account_type="CASH", currency="BDT"),
    ]
    balances.update(i=Decimal("100"), e=Decimal("-40"), a=Decimal("5"))
    pnl = accounting.generate_income_statement(Db([pnl_accounts]), "f", currency="bdt")
    assert pnl["net_income"] == "60"

    wallets = [SimpleNamespace(id="w", name="Cash", account_type="CASH", currency="BDT")]
    rows = [
        (SimpleNamespace(debit=10, credit=1), SimpleNamespace(transaction_type="INCOME")),
        (SimpleNamespace(debit=2, credit=7), SimpleNamespace(transaction_type="EXPENSE")),
        (SimpleNamespace(debit=20, credit=3), SimpleNamespace(transaction_type="LOAN_TAKEN")),
        (SimpleNamespace(debit=4, credit=9), SimpleNamespace(transaction_type="GOAL_SAVE")),
        (SimpleNamespace(debit=99, credit=99), SimpleNamespace(transaction_type="TRANSFER")),
        (SimpleNamespace(debit=5, credit=1), SimpleNamespace(transaction_type="ADJUSTMENT")),
    ]
    flow = accounting.generate_cash_flow(Db([wallets, rows]), "f")
    assert flow["operating"]["net"] == "8"
    assert flow["financing"]["net"] == "17"
    assert flow["investing"]["net"] == "-5"
    assert accounting.generate_cash_flow(Db([[]]), "f")["net_cash_flow"] == "0"


def test_accounting_posting_helpers(monkeypatch):
    captured = []

    def create(db, **kwargs):
        captured.append(kwargs)
        return SimpleNamespace(id=f"tx-{len(captured)}")

    chart = {
        "opening_equity": SimpleNamespace(id="equity"),
        "loan_payable": SimpleNamespace(id="payable"),
        "loan_receivable": SimpleNamespace(id="receivable"),
        "savings_pool": SimpleNamespace(id="savings"),
        "goal_pool": SimpleNamespace(id="goal"),
    }
    monkeypatch.setattr(accounting, "create_transaction", create)
    monkeypatch.setattr(accounting, "ensure_family_chart", lambda *a, **k: chart)
    monkeypatch.setattr(
        accounting,
        "ensure_named_coa_account",
        lambda *a, **k: SimpleNamespace(id="counterpart"),
    )
    wallet = SimpleNamespace(
        id="wallet", currency="BDT", current_balance=Decimal("100"), name="Cash"
    )
    other = SimpleNamespace(id="other", currency="BDT", current_balance=Decimal("0"), name="Bank")
    common = dict(db=Db(), family_id="f", member_id="m", wallet=wallet, amount=10, currency="bdt")

    accounting.post_income(
        Db(), family_id="f", member_id="m", account=wallet, amount=10, currency="bdt"
    )
    accounting.post_expense(
        Db(), family_id="f", member_id="m", account=wallet, amount=10, currency="bdt"
    )
    accounting.post_transfer(
        Db(),
        family_id="f",
        member_id="m",
        from_account=wallet,
        to_account=other,
        amount=10,
        currency="bdt",
    )
    accounting.post_loan_taken(**common)
    accounting.post_loan_given(**common)
    accounting.post_loan_installment(**common, loan_type="TAKEN")
    accounting.post_loan_installment(**common, loan_type="GIVEN")
    accounting.post_savings_deposit(**common)
    accounting.post_savings_withdraw(**common)
    accounting.post_goal_contribute(**common)
    accounting.post_goal_withdraw(**common)
    accounting.post_opening_balance(
        Db(), family_id="f", member_id="m", wallet=wallet, amount=Decimal("5")
    )
    assert len(captured) == 12
    assert {call["transaction_type"] for call in captured} >= {
        "INCOME",
        "EXPENSE",
        "TRANSFER",
        "LOAN_TAKEN",
        "LOAN_GIVEN",
        "SAVINGS_DEPOSIT",
        "GOAL_WITHDRAW",
        "OPENING_BALANCE",
    }
    assert accounting.post_opening_balance(
        Db(), family_id="f", member_id="m", wallet=wallet, amount=Decimal("0")
    ) is None


def test_accounting_posting_validation(monkeypatch):
    wallet = SimpleNamespace(id="same", currency="USD", current_balance=Decimal("1"), name="Wallet")
    with pytest.raises(HTTPException, match="Currency mismatch"):
        accounting.post_income(
            Db(), family_id="f", member_id="m", account=wallet, amount=1, currency="BDT"
        )
    with pytest.raises(HTTPException, match="Insufficient"):
        accounting.post_expense(
            Db(), family_id="f", member_id="m", account=wallet, amount=2, currency="USD"
        )
    with pytest.raises(HTTPException, match="same wallet"):
        accounting.post_transfer(
            Db(),
            family_id="f",
            member_id="m",
            from_account=wallet,
            to_account=wallet,
            amount=1,
            currency="USD",
        )
    with pytest.raises(HTTPException, match="negative"):
        accounting.post_opening_balance(
            Db(), family_id="f", member_id="m", wallet=wallet, amount=Decimal("-1")
        )


def test_email_disabled_validation_and_mocked_delivery(monkeypatch):
    monkeypatch.setattr(email_service.settings, "SMTP_HOST", "")
    monkeypatch.setattr(email_service.settings, "SMTP_FROM_EMAIL", "")
    assert not email_service.is_smtp_configured()
    assert not email_service.send_email(to_email="", subject="x", text_body="x").sent
    assert not email_service.send_email(to_email="a@b.com", subject="", text_body="x").sent
    assert email_service.send_email(
        to_email="A@B.COM", subject="x", text_body="x"
    ).reason == "SMTP not configured"

    monkeypatch.setattr(email_service.settings, "AUTH_EMAIL_ENABLED", False)
    assert email_service.send_password_reset_email(to_email="a@b.com", token="t").reason == (
        "Auth email disabled"
    )
    assert email_service.send_email_verification_email(
        to_email="a@b.com", token="t"
    ).reason == "Auth email disabled"
    monkeypatch.setattr(email_service.settings, "NOTIFICATION_EMAIL_ENABLED", False)
    assert email_service.send_notification_email(
        to_email="a@b.com", title="T", message="M"
    ).reason == "Notification email disabled"
    assert email_service.EmailSendResult(True, "sent").as_dict()["sent"]


def test_fcm_disabled_status_and_send(monkeypatch):
    monkeypatch.setattr(fcm_service.settings, "NOTIFICATION_FCM_ENABLED", False)
    monkeypatch.setattr(fcm_service.settings, "FCM_PROJECT_ID", "")
    monkeypatch.setattr(fcm_service.settings, "FCM_CREDENTIALS_PATH", "")
    status = fcm_service.fcm_status()
    assert not status["configured"]
    assert not fcm_service.is_fcm_configured()
    assert fcm_service.send_fcm_push(token="", title="T", body="B").reason == "Push token missing"
    assert fcm_service.send_fcm_push(token="tok", title="", body="B").reason == "Title missing"
    result = fcm_service.send_fcm_push(token="tok", title="T", body="B")
    assert not result.sent
    assert result.as_dict()["token"] == "tok"
    with pytest.raises(RuntimeError, match="not configured"):
        fcm_service._get_firebase_app()


def test_rate_limit_keys(monkeypatch):
    request = SimpleNamespace(
        headers={"authorization": "Bearer abc"}, client=SimpleNamespace(host="127.0.0.1")
    )
    monkeypatch.setattr("app.core.security.decode_token", lambda token: {"sub": "user-1"})
    assert rate_limit.rate_limit_key(request) == "user:user-1"
    monkeypatch.setattr("app.core.security.decode_token", lambda token: (_ for _ in ()).throw(ValueError()))
    assert rate_limit.rate_limit_key(request) == "127.0.0.1"
    monkeypatch.setattr(rate_limit.settings, "REDIS_URL", " redis://cache ")
    assert rate_limit._storage_uri() == "redis://cache"


def test_global_error_handlers():
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/http")
    def http_error():
        raise HTTPException(418, {"code": "TEAPOT", "message": "Short"})

    @app.get("/validation")
    def validation(value: int):
        return value

    @app.get("/db")
    def db_error():
        raise SQLAlchemyError("broken")

    @app.get("/unknown")
    def unknown_error():
        raise RuntimeError("broken")

    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/http").json()["error"]["code"] == "TEAPOT"
    assert client.get("/validation", params={"value": "x"}).status_code == 422
    assert client.get("/db").json()["error"]["code"] == "DB_001"
    assert client.get("/unknown").json()["error"]["code"] == "SERVER_ERROR"


def test_field_encryption_and_small_utils(monkeypatch):
    monkeypatch.setattr(field_encryption.settings, "FIELD_ENCRYPTION_KEY", "unit-test-secret")
    encrypted = field_encryption.encrypt_field("01700000000")
    assert field_encryption.is_encrypted(encrypted)
    assert field_encryption.encrypt_field("01700000000") == encrypted
    assert field_encryption.encrypt_field(encrypted) == encrypted
    assert field_encryption.decrypt_field(encrypted) == "01700000000"
    assert field_encryption.decrypt_field("plain") == "plain"
    assert field_encryption.encrypt_field(None) is None
    assert field_encryption.decrypt_field("") == ""
    random_encrypted = field_encryption.encrypt_field("secret", deterministic=False)
    assert field_encryption.decrypt_field(random_encrypted) == "secret"
    assert currency.money("1.23456") == "1.2346"
    assert currency.to_decimal("bad") == 0
    assert date_helper.to_iso(None) is None
    assert date_helper.to_iso(__import__("datetime").date(2025, 1, 2)) == "2025-01-02"
    assert "+00:00" in date_helper.to_iso(__import__("datetime").datetime(2025, 1, 2))


def test_finance_posting_helpers_and_flushes(monkeypatch):
    assert finance_posting._money("1.23456") == Decimal("1.2346")
    with pytest.raises(HTTPException, match="Invalid"):
        finance_posting._money("bad")
    with pytest.raises(HTTPException, match="greater"):
        finance_posting._money(0)
    assert finance_posting._income_account_name(SimpleNamespace(name_en="Salary", name_bn="")) == (
        "Salary Income"
    )
    assert finance_posting._income_account_name(SimpleNamespace(name_en="Bonus", name_bn="")) == (
        "Bonus Income"
    )
    assert finance_posting._expense_account_name(
        SimpleNamespace(name_en="Food and grocery", name_bn="")
    ) == "Grocery Expense"
    assert finance_posting._expense_account_name(SimpleNamespace(name_en="Rent", name_bn="")) == (
        "Rent Expense"
    )

    active = SimpleNamespace(is_active=True)
    assert finance_posting.get_account(Db([[active]]), "f", "a") is active
    with pytest.raises(HTTPException, match="Wallet not found"):
        finance_posting.get_account(Db([[]]), "f", "a")
    inactive = SimpleNamespace(is_active=False)
    with pytest.raises(HTTPException, match="inactive"):
        finance_posting.get_account(Db([[inactive]]), "f", "a")

    category = SimpleNamespace(
        id="c", family_id="f", deleted_at=None, category_type="INCOME", name_en="Salary", name_bn=""
    )
    assert finance_posting.get_category(Db(got=category), "f", "c", "INCOME") is category
    with pytest.raises(HTTPException, match="Category must"):
        finance_posting.get_category(Db(got=category), "f", "c", "EXPENSE")

    calls = []
    monkeypatch.setattr(
        finance_posting.accounting_service,
        "post_income",
        lambda *a, **k: calls.append(("income", k)) or SimpleNamespace(id="income"),
    )
    monkeypatch.setattr(
        finance_posting.accounting_service,
        "post_expense",
        lambda *a, **k: calls.append(("expense", k)) or SimpleNamespace(id="expense"),
    )
    monkeypatch.setattr(
        finance_posting.accounting_service,
        "post_transfer",
        lambda *a, **k: calls.append(("transfer", k)) or SimpleNamespace(id="transfer"),
    )
    monkeypatch.setattr(finance_posting, "get_category", lambda *a, **k: category)
    common = dict(db=Db(), family_id="f", member_id="m", account_id="a", category_id="c", amount=2)
    finance_posting.post_income_flush(**common)
    category.category_type = "EXPENSE"
    finance_posting.post_expense_flush(**common)
    finance_posting.post_transfer_flush(
        Db(), family_id="f", member_id="m", from_account_id="a", to_account_id="b", amount=2
    )
    assert [kind for kind, _ in calls] == ["income", "expense", "transfer"]
    assert finance_posting.find_by_client_request_id(Db(), "f", "") is None
    existing = SimpleNamespace(id="existing")
    monkeypatch.setattr(finance_posting, "find_by_client_request_id", lambda *a: existing)
    assert finance_posting.post_transfer_flush(
        Db(),
        family_id="f",
        member_id="m",
        from_account_id="a",
        to_account_id="b",
        amount=2,
        client_request_id="request",
    ) is existing


def test_notification_delivery_disabled_and_helpers(monkeypatch):
    monkeypatch.setattr(notification_delivery_service.settings, "NOTIFICATION_EMAIL_ENABLED", False)
    monkeypatch.setattr(notification_delivery_service.settings, "NOTIFICATION_FCM_ENABLED", False)
    monkeypatch.setattr(notification_delivery_service, "smtp_status", lambda: {"configured": False})
    monkeypatch.setattr(
        notification_delivery_service, "fcm_status", lambda: {"configured": False, "note": "off"}
    )
    notification = SimpleNamespace(
        id="n",
        family_id="f",
        user_id=None,
        title="Title | metadata",
        message="Body | metadata",
        notification_type="INFO",
    )
    result = notification_delivery_service.deliver_notification_channels(Db(), notification)
    assert result["email"][0]["reason"].endswith("false")
    assert result["push"][0]["reason"].endswith("false")
    assert notification_delivery_service.fanout_notification_ids(Db(), "f", [])["delivered"] == 0

    assert notification_delivery_service._member_user_ids(
        Db([[("u1",), (None,), ("u2",)]]), "f"
    ) == ["u1", "u2"]
    users = [
        SimpleNamespace(email=" B@EXAMPLE.COM "),
        SimpleNamespace(email="b@example.com"),
        SimpleNamespace(email=""),
    ]
    assert notification_delivery_service._emails_for_family(
        Db([[("u",)], users]), "f"
    ) == ["b@example.com"]
    assert notification_delivery_service._emails_for_family(Db([[]]), "f") == []
    token = SimpleNamespace(id="d", fcm_token="1234567890123456")
    assert notification_delivery_service._push_tokens(Db([[token]]), "f", "u") == [token]
    db = Db()
    outbox = notification_delivery_service._record_push_outbox(
        db,
        family_id="f",
        notification_id="n",
        token=token.fcm_token,
        title="T",
        body="B",
        status="SENT",
    )
    assert outbox.status == "SENT" and outbox.sent_at is not None
    status = notification_delivery_service.pipeline_status()
    assert status["architecture_status"] == "DONE"


def test_notification_fanout_rows(monkeypatch):
    rows = [SimpleNamespace(id="n1"), SimpleNamespace(id="n2")]
    monkeypatch.setattr(
        notification_delivery_service,
        "deliver_notification_channels",
        lambda db, row: {"notification_id": row.id},
    )
    db = Db([rows])
    result = notification_delivery_service.fanout_notification_ids(db, "f", ["n1", "n2"])
    assert result["delivered"] == 2
    assert db.commit_count == 1


def test_architecture_readiness(monkeypatch):
    monkeypatch.setattr(architecture_readiness_service.settings, "GOOGLE_VISION_ENABLED", True)
    monkeypatch.setattr(
        architecture_readiness_service.settings, "GOOGLE_APPLICATION_CREDENTIALS", "creds.json"
    )
    ocr = architecture_readiness_service.ocr_status()
    assert "google_vision" in ocr["engines"]
    monkeypatch.setattr(
        architecture_readiness_service, "object_storage_status", lambda: {"backend": "local"}
    )
    monkeypatch.setattr(
        architecture_readiness_service,
        "notification_pipeline_status",
        lambda: {"architecture_status": "DONE"},
    )
    monkeypatch.setattr(
        architecture_readiness_service, "fcm_status", lambda: {"configured": False}
    )
    monkeypatch.setattr(
        architecture_readiness_service, "smtp_status", lambda: {"configured": False}
    )
    result = architecture_readiness_service.architecture_readiness()
    assert result["architecture_feature_completeness_pct"] == 100
    assert result["done_count"] == result["module_count"]


def test_job_queue_inline_and_delayed(monkeypatch):
    from app.workers import celery_tasks

    monkeypatch.setattr(celery_tasks, "send_push_task", lambda *a: {"kind": "push"})
    monkeypatch.setattr(celery_tasks, "send_email_task", lambda *a: {"kind": "email"})
    monkeypatch.setattr(celery_tasks, "generate_report_task", lambda *a: {"kind": "report"})
    monkeypatch.setattr(celery_tasks, "export_job_task", lambda *a: {"kind": "export"})
    monkeypatch.setattr(job_queue.settings, "CELERY_ENABLED", False)
    assert job_queue.enqueue_push("t", "T", "B")["kind"] == "push"
    assert job_queue.enqueue_email("a@b.com", "S", "B")["kind"] == "email"
    assert job_queue.enqueue_report("f")["kind"] == "report"
    assert job_queue.enqueue_export_job("j")["kind"] == "export"
