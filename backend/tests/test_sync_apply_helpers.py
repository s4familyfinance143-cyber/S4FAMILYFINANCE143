"""Focused unit coverage for sync_apply helpers and small apply paths."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import sync_apply as sa


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ({"a": 1}, {"a": 1}),
        ([1, 2], [1, 2]),
        ('{"a": 1}', {"a": 1}),
        ("not-json", "not-json"),
    ],
)
def test_load_json_normalizes_supported_values(value, expected):
    assert sa._load_json(value) == expected


def test_json_text_supports_unicode_and_non_json_types():
    encoded = sa._json_text({"name": "সঞ্চয়", "amount": Decimal("1.25")})
    assert "সঞ্চয়" in encoded
    assert '"1.25"' in encoded


@pytest.mark.parametrize(
    ("value", "default", "expected"),
    [
        ("12.50", "0", Decimal("12.50")),
        (None, "7", Decimal("7")),
        ("", "3", Decimal("3")),
        ("invalid", "9", Decimal("9")),
    ],
)
def test_decimal_normalization(value, default, expected):
    assert sa._dec(value, default) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, None), ("  ", None), ("  hello  ", "hello"), (42, "42")],
)
def test_clean(value, expected):
    assert sa._clean(value) == expected


def test_server_snapshot_selects_and_serializes_known_fields():
    row = SimpleNamespace(
        id="x",
        name="List",
        amount=Decimal("2.50"),
        updated_at=datetime(2026, 8, 12, 1, 2, 3),
        secret="excluded",
    )
    assert sa._server_snapshot(row) == {
        "id": "x",
        "name": "List",
        "updated_at": "2026-08-12T01:02:03",
        "amount": 2.5,
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("2026-08-12T10:00:00Z", date(2026, 8, 12)),
        ("bad", None),
        (date(2026, 1, 2), date(2026, 1, 2)),
    ],
)
def test_parse_date(value, expected):
    assert sa._parse_date(value) == expected


def test_check_version_merge_lww_invalid_and_match_paths():
    row = SimpleNamespace(
        id="i1",
        sync_version=4,
        updated_at="2026-08-12T10:00:00",
        last_client_updated_at=None,
    )
    assert sa._check_version(row, {"is_bought": True, "sync_version": 1}) is None
    assert sa._check_version(row, {"name": "x", "sync_version": "bad"}) is None
    assert sa._check_version(row, {"name": "x", "sync_version": 4}) is None

    conflict = sa._check_version(
        row, {"name": "old", "client_updated_at": "2026-08-11T10:00:00"}
    )
    assert conflict["reason"] == "LAST_WRITE_WINS_SERVER_NEWER"


def test_bump_sets_version_and_client_timestamp():
    row = SimpleNamespace(sync_version=None, last_client_updated_at=None)
    sa._bump(row, {"client_updated_at": " 2026-08-12 "})
    assert row.sync_version == 1
    assert row.last_client_updated_at == "2026-08-12"


def test_open_conflict_serializes_reason_and_ignores_notification_error(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr(sa.uuid, "uuid4", lambda: "conflict-id")
    monkeypatch.setattr(
        "app.api.v1.notifications.create_notification", lambda *args, **kwargs: None
    )

    conflict_id = sa._open_conflict(
        db,
        family_id="f1",
        device_id="d1",
        entity_type="grocery_items",
        entity_id=123,
        local_payload={"name": "local"},
        remote_payload={"name": "remote"},
        reason="DELETE_EDIT_RACE",
    )

    assert conflict_id == "conflict-id"
    added = db.add.call_args.args[0]
    assert added.entity_id == "123"
    assert '"conflict_reason": "DELETE_EDIT_RACE"' in added.local_payload


def test_set_outbox_status_builds_expected_parameters():
    db = MagicMock()
    row = SimpleNamespace(
        id="o1",
        status="PENDING",
        error_message=None,
        updated_at=None,
        synced_at=None,
    )
    db.query.return_value.filter.return_value.first.return_value = row
    sa._set_outbox_status(db, "o1", "FAILED", "bad payload")
    assert row.status == "FAILED"
    assert row.error_message == "bad payload"


def test_find_grocery_rows_fall_back_to_mobile_key():
    db = MagicMock()
    query = db.query.return_value
    query.filter.return_value.first.side_effect = [None, "by-key", None, "item-key"]
    assert sa._find_grocery_list(db, "f1", "missing", {"mobile_sync_key": " k "}) == "by-key"
    assert sa._find_grocery_item(db, "f1", "missing", {"mobile_sync_key": " i "}) == "item-key"
    assert sa._find_grocery_list(db, "f1", None, {}) is None


def test_version_gate_handles_lww_and_opens_delete_conflict(monkeypatch):
    row = SimpleNamespace(id="x", sync_version=3, updated_at=None)
    monkeypatch.setattr(
        sa,
        "_check_version",
        lambda *_: {"reason": "LAST_WRITE_WINS_SERVER_NEWER"},
    )
    result = sa._gate_version_or_conflict(
        MagicMock(),
        family_id="f",
        device_id="d",
        entity_type="grocery_lists",
        row=row,
        payload={},
        operation="UPDATE",
    )
    assert result["note"] == "lww_server_wins"

    monkeypatch.setattr(sa, "_check_version", lambda *_: {"server": {"id": "x"}})
    opened = MagicMock(return_value="c1")
    monkeypatch.setattr(sa, "_open_conflict", opened)
    result = sa._gate_version_or_conflict(
        MagicMock(),
        family_id="f",
        device_id="d",
        entity_type="grocery_lists",
        row=row,
        payload={},
        operation="DELETE",
    )
    assert result == {"status": "CONFLICT", "conflict_id": "c1", "entity_id": "x"}
    assert opened.call_args.kwargs["reason"] == "DELETE_EDIT_RACE"


def test_grocery_list_create_update_delete_paths(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr(sa, "_find_grocery_list", lambda *_: None)
    missing_member = sa._apply_grocery_list(
        db, family_id="f", device_id="d", operation="CREATE",
        entity_id=None, payload={}, member_id=None,
    )
    assert missing_member["status"] == "FAILED"

    created = sa._apply_grocery_list(
        db, family_id="f", device_id="d", operation="CREATE",
        entity_id="l1", payload={"title": " Weekly ", "budget_amount": "15"}, member_id="m",
    )
    assert created == {"status": "SYNCED", "entity_id": "l1"}
    added = db.add.call_args.args[0]
    assert added.name == "Weekly"
    assert added.budget_amount == Decimal("15")

    row = SimpleNamespace(
        id="l1", sync_version=1, last_client_updated_at=None, mobile_sync_key=None,
        name="Old", status="OPEN", budget_amount=Decimal("1"), currency="BDT",
        vendor_name=None, shopping_date=None, note=None, updated_at=None,
    )
    monkeypatch.setattr(sa, "_find_grocery_list", lambda *_: row)
    updated = sa._apply_grocery_list(
        db, family_id="f", device_id="d", operation="UPDATE", entity_id="l1",
        payload={"name": "New", "budget_amount": "2", "mobile_sync_key": "key"},
        member_id="m",
    )
    assert updated["status"] == "SYNCED"
    assert (row.name, row.budget_amount, row.sync_version) == ("New", Decimal("2"), 2)

    deleted = sa._apply_grocery_list(
        db, family_id="f", device_id="d", operation="DELETE", entity_id="l1",
        payload={"expected_sync_version": 2}, member_id="m",
    )
    assert deleted["status"] == "SYNCED"
    db.delete.assert_called_with(row)


def test_grocery_item_validation_and_update(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr(sa, "_find_grocery_item", lambda *_: None)
    result = sa._apply_grocery_item(
        db, family_id="f", device_id="d", operation="CREATE",
        entity_id=None, payload={}, member_id="m",
    )
    assert result["error"] == "grocery_list_id required"

    row = SimpleNamespace(
        id="i1", sync_version=1, last_client_updated_at=None, updated_at=None,
        mobile_sync_key=None, name="Rice", category="FOOD", quantity=Decimal("1"),
        unit="kg", estimated_price=Decimal("2"), actual_price=Decimal("0"),
        vendor_name=None, barcode=None, note=None, is_bought=False,
    )
    monkeypatch.setattr(sa, "_find_grocery_item", lambda *_: row)
    result = sa._apply_grocery_item(
        db, family_id="f", device_id="d", operation="UPDATE", entity_id="i1",
        payload={"quantity": "3", "is_bought": True, "note": " done "}, member_id="m",
    )
    assert result["status"] == "SYNCED"
    assert (row.quantity, row.is_bought, row.note, row.sync_version) == (
        Decimal("3"), True, "done", 2
    )


def test_grocery_vendor_create_update_and_absent_delete():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert sa._apply_grocery_vendor(
        db, family_id="f", device_id="d", operation="CREATE",
        entity_id=None, payload={"name": " "}, member_id="m",
    )["error"] == "vendor name required"

    result = sa._apply_grocery_vendor(
        db, family_id="f", device_id="d", operation="CREATE",
        entity_id="v1", payload={"name": " Market ", "is_active": False}, member_id="m",
    )
    assert result["status"] == "SYNCED"
    assert db.add.call_args.args[0].name == "Market"

    assert sa._apply_grocery_vendor(
        db, family_id="f", device_id="d", operation="DELETE",
        entity_id="missing", payload={}, member_id="m",
    )["note"] == "already_absent"


@pytest.mark.parametrize(
    ("entity_type", "target"),
    [
        ("transactions", "_apply_transaction"),
        ("zakat_records", "_apply_zakat_record"),
        ("phase15_items", "_apply_phase15_item"),
        ("phase16_items", "_apply_phase16_item"),
        ("grocery_lists", "_apply_grocery_list"),
        ("grocery_items", "_apply_grocery_item"),
        ("grocery_vendors", "_apply_grocery_vendor"),
        ("accounts", "_apply_account"),
        ("budgets", "_apply_budget"),
        ("savings_goals", "_apply_savings_goal"),
        ("loans", "_apply_loan"),
        ("financial_goals", "_apply_financial_goal"),
        ("recurring_transactions", "_apply_recurring_transaction"),
        ("investments", "_apply_architecture_entity"),
    ],
)
def test_apply_one_change_dispatches_and_normalizes(monkeypatch, entity_type, target):
    called = MagicMock(return_value={"status": "SYNCED", "entity_id": "x"})
    monkeypatch.setattr(sa, target, called)
    result = sa.apply_one_change(
        MagicMock(), family_id="f", device_id="d", entity_type=entity_type,
        operation=" update ", entity_id="x", payload="not-a-dict", member_id="m",
    )
    assert result["status"] == "SYNCED"
    assert called.call_args.kwargs["operation"] == "UPDATE"
    assert called.call_args.kwargs["payload"] == {}


def test_process_pending_outbox_builds_filters_and_maps_statuses(monkeypatch):
    from app.models.sync_tables import SyncOutbox

    db = MagicMock()
    rows = [
        SimpleNamespace(
            id="o1",
            device_id="d",
            entity_type="accounts",
            operation="CREATE",
            entity_id=None,
            payload='{"name":"Cash"}',
        ),
        SimpleNamespace(
            id="o2",
            device_id=None,
            entity_type="accounts",
            operation="UPDATE",
            entity_id="a2",
            payload="{}",
        ),
        SimpleNamespace(
            id="o3",
            device_id="d",
            entity_type="bad",
            operation="CREATE",
            entity_id=None,
            payload=None,
        ),
    ]
    chain = db.query.return_value
    chain.filter.return_value = chain
    chain.order_by.return_value.limit.return_value.all.return_value = rows
    results = iter([
        {"status": "SYNCED", "entity_id": "a1", "conflict_id": "resolved-c"},
        {"status": "CONFLICT", "conflict_id": "open-c"},
        {"status": "FAILED", "error": "bad"},
    ])
    monkeypatch.setattr(sa, "apply_one_change", lambda *a, **k: next(results))
    set_status = MagicMock()
    monkeypatch.setattr(sa, "_set_outbox_status", set_status)

    summary = sa.process_pending_outbox(
        db, family_id="f", device_id="d", member_id="m",
        outbox_ids=["o1", "o2"], limit=10,
    )

    db.query.assert_called_with(SyncOutbox)
    assert chain.filter.call_count >= 2
    chain.order_by.return_value.limit.assert_called_with(10)
    assert summary["synced_count"] == 1
    assert summary["failed_count"] == 1
    assert summary["conflict_ids"] == ["resolved-c", "open-c"]
    assert summary["conflicted_outbox_ids"] == ["o2"]
    assert [call.args[2] for call in set_status.call_args_list] == [
        "SYNCED", "CONFLICT", "FAILED"
    ]


def test_conflict_resolution_keep_local_merge_force_and_unknown(monkeypatch):
    db = MagicMock()
    conflict = {
        "entity_type": "grocery_items",
        "entity_id": "i1",
        "local_payload": '{"name":"local","id":"ignore","nullable":null}',
        "remote_payload": {"name": "remote", "sync_version": 3, "category": "FOOD"},
    }
    apply = MagicMock(side_effect=[
        {"status": "SYNCED", "entity_id": "i1"},
        {"status": "CONFLICT"},
    ])
    force = MagicMock(return_value={"status": "SYNCED", "entity_id": "i1"})
    monkeypatch.setattr(sa, "apply_one_change", apply)
    monkeypatch.setattr(sa, "_force_apply_payload", force)

    local = sa.apply_conflict_resolution(
        db, family_id="f", device_id="d", conflict_row=conflict,
        body={"strategy": "client"}, member_id="m",
    )
    assert local["applied"] is True
    assert apply.call_args.kwargs["payload"]["expected_sync_version"] == 3

    merged = sa.apply_conflict_resolution(
        db, family_id="f", device_id="d", conflict_row=conflict,
        body={"strategy": "merge", "chosen": {"name": "chosen"}}, member_id="m",
    )
    assert merged["applied"] is True
    merged_payload = apply.call_args.kwargs["payload"]
    assert merged_payload["name"] == "chosen"
    assert merged_payload["category"] == "FOOD"
    force.assert_called_once()

    unknown = sa.apply_conflict_resolution(
        db, family_id="f", device_id="d", conflict_row=conflict,
        body={"strategy": "mystery"}, member_id="m",
    )
    assert unknown["error"] == "unknown strategy"


def test_force_apply_grocery_item_and_unsupported():
    row = SimpleNamespace(
        id="i1", name="Old", category="GENERAL", quantity=Decimal("1"), unit="pcs",
        estimated_price=Decimal("0"), actual_price=Decimal("0"), is_bought=False,
        note=None, vendor_name=None, sync_version=2, last_client_updated_at=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = row
    result = sa._force_apply_payload(
        db, family_id="f", entity_type="grocery_items", entity_id="i1",
        payload={"name": "New", "quantity": "4", "is_bought": True,
                 "expected_sync_version": 1, "client_updated_at": "now"},
    )
    assert result["status"] == "SYNCED"
    assert (row.name, row.quantity, row.is_bought, row.sync_version) == (
        "New", Decimal("4"), True, 3
    )
    assert sa._force_apply_payload(
        db, family_id="f", entity_type="unknown", entity_id="x", payload={}
    )["status"] == "FAILED"
