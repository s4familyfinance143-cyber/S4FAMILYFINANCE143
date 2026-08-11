"""Unit tests for sync outbox applicator + conflict resolution."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import sync_apply as sa


def test_check_version_mismatch_detects_conflict():
    row = SimpleNamespace(sync_version=3, id="g1", family_id="f1", title="A", updated_at=None)
    conflict = sa._check_version(row, {"expected_sync_version": 2})
    assert conflict is not None
    assert conflict["code"] == "SYNC_CONFLICT"
    assert conflict["server_sync_version"] == 3


def test_check_version_match_ok():
    row = SimpleNamespace(sync_version=2, id="g1")
    assert sa._check_version(row, {"expected_sync_version": 2}) is None


def test_apply_one_change_rejects_unknown_entity():
    db = MagicMock()
    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="unknown_thing",
        operation="UPDATE",
        entity_id="x",
        payload={},
        member_id="m1",
    )
    assert result["status"] == "FAILED"


def test_apply_one_change_transactions_requires_type():
    db = MagicMock()
    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="transactions",
        operation="CREATE",
        entity_id=None,
        payload={"amount": 10},
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "transaction_type" in result["error"]

def test_keep_server_resolution_skips_write():
    db = MagicMock()
    info = sa.apply_conflict_resolution(
        db,
        family_id="f1",
        device_id="d1",
        conflict_row={
            "entity_type": "grocery_items",
            "entity_id": "item-1",
            "local_payload": {"name": "local"},
            "remote_payload": {"name": "server", "sync_version": 2},
        },
        body={"strategy": "keep_server"},
        member_id="m1",
    )
    assert info["strategy"] == "keep_server"
    assert info["applied"] is False


def test_allowed_entity_types_cover_pull_vocab():
    for key in (
        "grocery_lists",
        "grocery_items",
        "grocery_vendors",
        "accounts",
        "transactions",
        "zakat_records",
        "phase15_items",
        "phase16_items",
        "budgets",
        "savings_goals",
        "loans",
        "financial_goals",
        "recurring_transactions",
    ):
        assert key in sa.ALLOWED_ENTITY_TYPES


def test_apply_budget_create_requires_member_and_category():
    db = MagicMock()
    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="budgets",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Food"},
        member_id=None,
    )
    assert result["status"] == "FAILED"
    assert "member_id" in result["error"]

    result2 = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="budgets",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Food"},
        member_id="m1",
    )
    assert result2["status"] == "FAILED"
    assert "category_id" in result2["error"]


def test_apply_savings_create_requires_wallet(monkeypatch):
    db = MagicMock()
    import sys
    import types

    class FakeGoal:
        def __init__(self, **kwargs):
            self.id = "g1"
            for k, v in kwargs.items():
                setattr(self, k, v)

    m = types.ModuleType("app.models.savings")
    m.SavingsGoal = FakeGoal
    monkeypatch.setitem(sys.modules, "app.models.savings", m)
    db.query.return_value.filter.return_value.first.return_value = None

    result = sa._apply_savings_goal(
        db,
        family_id="f1",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Hajj", "target_amount": "10000", "wallet_account_id": "missing"},
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "wallet" in result["error"].lower()


def test_apply_account_create_requires_member():
    db = MagicMock()
    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="accounts",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Cash"},
        member_id=None,
    )
    assert result["status"] == "FAILED"
    assert "member_id" in result["error"]


def test_apply_phase16_create_requires_member_id():
    db = MagicMock()
    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="phase16_items",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Netflix", "module_type": "SUBSCRIPTION"},
        member_id=None,
    )
    assert result["status"] == "FAILED"
    assert "member_id" in result["error"]


def test_apply_phase16_update_existing(monkeypatch):
    db = MagicMock()
    row = SimpleNamespace(
        id="p16-1",
        family_id="f1",
        name="Old",
        module_type="SUBSCRIPTION",
        status="ACTIVE",
        amount=0,
        note=None,
        provider=None,
        category="GENERAL",
        sub_type=None,
        billing_cycle=None,
        reference=None,
        renewal_or_expiry_date=None,
        payment_account_id=None,
        file_name=None,
    )
    monkeypatch.setattr(sa, "_apply_phase16_item", sa._apply_phase16_item)

    class FakePhase16:
        pass

    # Patch model get path inside apply
    fake_mod = SimpleNamespace(Phase16Item=object)

    def fake_get(model, entity_id):
        assert entity_id == "p16-1"
        return row

    db.get = fake_get

    import sys
    import types

    mod = types.ModuleType("app.models.phase16")
    mod.Phase16Item = type("Phase16Item", (), {})
    monkeypatch.setitem(sys.modules, "app.models.phase16", mod)

    result = sa._apply_phase16_item(
        db,
        family_id="f1",
        operation="UPDATE",
        entity_id="p16-1",
        payload={"name": "Netflix Plus", "amount": "1200"},
        member_id="m1",
    )
    assert result["status"] == "SYNCED"
    assert row.name == "Netflix Plus"


def test_apply_zakat_computes_due_when_missing(monkeypatch):
    db = MagicMock()
    created = {}

    class FakeZakat:
        family_id = SimpleNamespace()
        note = SimpleNamespace(isnot=staticmethod(lambda *_a, **_k: True))

        def __init__(self, **kwargs):
            created.update(kwargs)
            self.id = "z1"
            for k, v in kwargs.items():
                setattr(self, k, v)

    import sys
    import types

    m = types.ModuleType("app.models.zakat")
    m.ZakatRecord = FakeZakat
    monkeypatch.setitem(sys.modules, "app.models.zakat", m)

    # Avoid idempotent note scan query complexity
    db.query.return_value.filter.return_value.all.return_value = []

    result = sa._apply_zakat_record(
        db,
        family_id="f1",
        operation="CREATE",
        payload={
            "calculation_year": "2026",
            "currency": "BDT",
            "cash_amount": "100000",
            "gold_value": "0",
            "silver_value": "0",
            "investment_value": "0",
            "business_assets": "0",
            "receivables": "0",
            "deductible_debts": "0",
            "nisab_amount": "85000",
            "client_request_id": "test-zakat-1",
        },
        member_id="m1",
    )
    assert result["status"] == "SYNCED"
    assert created["zakatable_amount"] == sa._dec("100000")
    assert created["zakat_due"] == sa._dec("2500")


def test_apply_grocery_item_auto_opens_conflict_on_version_mismatch(monkeypatch):
    """Step 4: version mismatch creates OPEN conflict without client conflict flag."""
    db = MagicMock()
    item = SimpleNamespace(
        id="item-1",
        family_id="f1",
        sync_version=5,
        name="Rice",
        updated_at=None,
        quantity=1,
        unit="kg",
        estimated_price=0,
        actual_price=0,
        vendor_name=None,
        note=None,
        category="GENERAL",
        is_bought=False,
        mobile_sync_key=None,
        last_client_updated_at=None,
    )
    monkeypatch.setattr(sa, "_find_grocery_item", lambda *a, **k: item)
    opened = {}

    def fake_open(_db, **kwargs):
        opened.update(kwargs)
        return "conflict-99"

    monkeypatch.setattr(sa, "_open_conflict", fake_open)

    result = sa.apply_one_change(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="grocery_items",
        operation="UPDATE",
        entity_id="item-1",
        payload={"name": "Rice XL", "expected_sync_version": 2},
        member_id="m1",
    )
    assert result["status"] == "CONFLICT"
    assert result["conflict_id"] == "conflict-99"
    assert opened["entity_type"] == "grocery_items"
    assert opened["entity_id"] == "item-1"


def test_apply_savings_deposit_requires_wallet(monkeypatch):
    db = MagicMock()
    import sys
    import types

    class FakeGoal:
        id = "g1"
        family_id = "f1"
        status = "ACTIVE"
        currency = "AED"
        current_amount = "100"
        name = "Hajj"

    class FakeTx:
        def __init__(self, **kwargs):
            self.id = "tx1"
            self.goal_id = kwargs.get("goal_id")
            for k, v in kwargs.items():
                setattr(self, k, v)

    class FakeLine:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    m = types.ModuleType("app.models.savings")
    m.SavingsGoal = object
    monkeypatch.setitem(sys.modules, "app.models.savings", m)
    mt = types.ModuleType("app.models.transaction")
    mt.Transaction = FakeTx
    monkeypatch.setitem(sys.modules, "app.models.transaction", mt)
    ml = types.ModuleType("app.models.transaction_line")
    ml.TransactionLine = FakeLine
    monkeypatch.setitem(sys.modules, "app.models.transaction_line", ml)

    goal = FakeGoal()
    db.get.return_value = goal
    db.query.return_value.filter.return_value.first.return_value = None

    result = sa._apply_savings_goal(
        db,
        family_id="f1",
        operation="DEPOSIT",
        entity_id="g1",
        payload={"amount": "50", "wallet_account_id": "missing", "currency": "AED"},
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "wallet" in result["error"].lower()


def test_apply_loan_payment_requires_amount(monkeypatch):
    db = MagicMock()
    import sys
    import types

    class FakeLoan:
        id = "l1"
        family_id = "f1"
        status = "ACTIVE"
        currency = "AED"
        loan_type = "TAKEN"
        remaining_amount = "200"
        paid_amount = "0"
        person_name = "Ali"

    class FakeTx:
        def __init__(self, **kwargs):
            self.id = "tx1"
            self.loan_id = kwargs.get("loan_id")
            for k, v in kwargs.items():
                setattr(self, k, v)

    class FakeLine:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    m = types.ModuleType("app.models.loan")
    m.Loan = object
    monkeypatch.setitem(sys.modules, "app.models.loan", m)
    mt = types.ModuleType("app.models.transaction")
    mt.Transaction = FakeTx
    monkeypatch.setitem(sys.modules, "app.models.transaction", mt)
    ml = types.ModuleType("app.models.transaction_line")
    ml.TransactionLine = FakeLine
    monkeypatch.setitem(sys.modules, "app.models.transaction_line", ml)

    db.get.return_value = FakeLoan()
    result = sa._apply_loan(
        db,
        family_id="f1",
        operation="PAYMENT",
        entity_id="l1",
        payload={"amount": "0", "wallet_account_id": "w1", "currency": "AED"},
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "amount" in result["error"].lower()


def test_apply_recurring_create_requires_start_date(monkeypatch):
    db = MagicMock()
    import sys
    import types

    class FakeRecurring:
        def __init__(self, **kwargs):
            self.id = "r1"
            for k, v in kwargs.items():
                setattr(self, k, v)

    m = types.ModuleType("app.models.recurring")
    m.RecurringTransaction = FakeRecurring
    monkeypatch.setitem(sys.modules, "app.models.recurring", m)
    db.query.return_value.filter.return_value.first.return_value = object()

    result = sa._apply_recurring_transaction(
        db,
        family_id="f1",
        operation="CREATE",
        entity_id=None,
        payload={
            "title": "Rent",
            "account_id": "w1",
            "transaction_type": "EXPENSE",
            "amount": "100",
            "frequency": "MONTHLY",
        },
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "start_date" in result["error"].lower()


def test_apply_financial_goal_contribute_requires_wallet(monkeypatch):
    db = MagicMock()
    import sys
    import types

    class FakeGoal:
        id = "fg1"
        family_id = "f1"
        status = "ACTIVE"
        currency = "AED"
        current_amount = "10"
        target_amount = "100"
        linked_savings_goal_id = None
        goal_name = "Car"

    class FakeTx:
        def __init__(self, **kwargs):
            self.id = "tx1"
            self.goal_id = kwargs.get("goal_id")
            for k, v in kwargs.items():
                setattr(self, k, v)

    class FakeLine:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    mg = types.ModuleType("app.models.goal")
    mg.FinancialGoal = object
    monkeypatch.setitem(sys.modules, "app.models.goal", mg)
    ms = types.ModuleType("app.models.savings")
    ms.SavingsGoal = object
    monkeypatch.setitem(sys.modules, "app.models.savings", ms)
    mt = types.ModuleType("app.models.transaction")
    mt.Transaction = FakeTx
    monkeypatch.setitem(sys.modules, "app.models.transaction", mt)
    ml = types.ModuleType("app.models.transaction_line")
    ml.TransactionLine = FakeLine
    monkeypatch.setitem(sys.modules, "app.models.transaction_line", ml)

    db.get.return_value = FakeGoal()
    db.query.return_value.filter.return_value.first.return_value = None
    result = sa._apply_financial_goal(
        db,
        family_id="f1",
        operation="CONTRIBUTE",
        entity_id="fg1",
        payload={"amount": "25", "wallet_account_id": "missing", "currency": "AED"},
        member_id="m1",
    )
    assert result["status"] == "FAILED"
    assert "wallet" in result["error"].lower()
