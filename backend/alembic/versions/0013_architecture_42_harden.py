"""Architecture 42+ harden: create checklist tables + migrate from aliases.

Revision ID: 0013_architecture_42_harden
Revises: 0012_tx_client_request_id
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "0013_architecture_42_harden"
down_revision: Union[str, None] = "0012_tx_client_request_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = [
    "user_preferences",
    "refresh_tokens",
    "device_sessions",
    "push_tokens",
    "tags",
    "transaction_tags",
    "loan_payments",
    "expense_categories",
    "income_categories",
    "vendor_contacts",
    "grocery_list_items",
    "investments",
    "investment_returns",
    "health_expenses",
    "vehicle_expenses",
    "properties",
    "subscriptions",
    "documents",
    "sync_queue",
    "sync_logs",
    "device_registry",
    "notification_templates",
    "api_logs",
    "rate_limits",
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    # Import models so metadata is complete, then create missing tables only.
    import app.models  # noqa: F401
    from app.models.base import Base

    for table_name in NEW_TABLES:
        if insp.has_table(table_name):
            continue
        table = Base.metadata.tables.get(table_name)
        if table is not None:
            table.create(bind=bind, checkfirst=True)

    # Also ensure previously ORM-only tables exist in Alembic-managed DBs.
    for extra in (
        "ownership_transfer_requests",
        "family_tasks",
        "family_calendar_events",
        "export_jobs",
        "email_outbox",
        "reminder_schedules",
        "sync_devices",
        "sync_state",
        "sync_outbox",
        "sync_inbox",
        "sync_conflicts",
    ):
        if not insp.has_table(extra):
            table = Base.metadata.tables.get(extra)
            if table is not None:
                table.create(bind=bind, checkfirst=True)

    # Refresh inspector after creates
    insp = inspect(bind)

    def has(t: str) -> bool:
        return insp.has_table(t)

    # --- Data migrations (idempotent via legacy_* / NOT EXISTS patterns) ---
    if has("users") and has("user_preferences"):
        bind.execute(
            text(
                """
                INSERT INTO user_preferences (id, user_id, theme, language, notification_on, currency, created_at, updated_at, deleted_at)
                SELECT u.id || '-pref', u.id, 'light', COALESCE(u.preferred_language, 'bn'), TRUE, 'BDT',
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
                FROM users u
                WHERE NOT EXISTS (
                    SELECT 1 FROM user_preferences p WHERE p.user_id = u.id AND p.deleted_at IS NULL
                )
                """
            )
        )

    if has("auth_sessions") and has("refresh_tokens"):
        bind.execute(
            text(
                """
                INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at, revoked, legacy_session_id, created_at, updated_at, deleted_at)
                SELECT s.id || '-rt', s.user_id, s.refresh_token_hash, s.device_label, s.expires_at,
                       CASE WHEN s.status = 'ACTIVE' AND s.revoked_at IS NULL THEN FALSE ELSE TRUE END,
                       s.id, s.created_at, s.updated_at, s.deleted_at
                FROM auth_sessions s
                WHERE NOT EXISTS (
                    SELECT 1 FROM refresh_tokens r WHERE r.legacy_session_id = s.id
                )
                """
            )
        )
        bind.execute(
            text(
                """
                INSERT INTO device_sessions (id, user_id, device_name, platform, fcm_token, last_active, ip_address, user_agent, legacy_session_id, created_at, updated_at, deleted_at)
                SELECT s.id || '-ds', s.user_id, s.device_label, NULL, NULL, s.updated_at, s.ip_address, s.user_agent, s.id,
                       s.created_at, s.updated_at, s.deleted_at
                FROM auth_sessions s
                WHERE NOT EXISTS (
                    SELECT 1 FROM device_sessions d WHERE d.legacy_session_id = s.id
                )
                """
            )
        )

    if has("push_devices") and has("push_tokens"):
        bind.execute(
            text(
                """
                INSERT INTO push_tokens (id, user_id, device_id, fcm_token, platform, is_active, family_id, legacy_push_device_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-pt', p.user_id, p.device_label, p.token, p.platform, p.is_active, p.family_id, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM push_devices p
                WHERE NOT EXISTS (
                    SELECT 1 FROM push_tokens t WHERE t.legacy_push_device_id = p.id
                )
                """
            )
        )

    if has("categories") and has("expense_categories"):
        bind.execute(
            text(
                """
                INSERT INTO expense_categories (id, family_id, parent_id, name, name_bn, name_en, icon, color, is_system, is_active, legacy_category_id, created_at, updated_at, deleted_at)
                SELECT c.id || '-exp', c.family_id, NULL, COALESCE(c.name_en, c.name_bn), c.name_bn, c.name_en, c.icon, c.color, c.is_system, c.is_active, c.id,
                       c.created_at, c.updated_at, c.deleted_at
                FROM categories c
                WHERE UPPER(c.category_type) LIKE '%EXPENSE%'
                  AND NOT EXISTS (SELECT 1 FROM expense_categories e WHERE e.legacy_category_id = c.id)
                """
            )
        )
    if has("categories") and has("income_categories"):
        bind.execute(
            text(
                """
                INSERT INTO income_categories (id, family_id, name, name_bn, name_en, icon, color, is_system, is_active, legacy_category_id, created_at, updated_at, deleted_at)
                SELECT c.id || '-inc', c.family_id, COALESCE(c.name_en, c.name_bn), c.name_bn, c.name_en, c.icon, c.color, c.is_system, c.is_active, c.id,
                       c.created_at, c.updated_at, c.deleted_at
                FROM categories c
                WHERE UPPER(c.category_type) LIKE '%INCOME%'
                  AND NOT EXISTS (SELECT 1 FROM income_categories i WHERE i.legacy_category_id = c.id)
                """
            )
        )

    if has("grocery_vendors") and has("vendor_contacts"):
        bind.execute(
            text(
                """
                INSERT INTO vendor_contacts (id, family_id, name, phone, address, category, notes, is_active, legacy_grocery_vendor_id, created_at, updated_at, deleted_at)
                SELECT v.id || '-vc', v.family_id, v.name, v.phone, v.address, v.category, v.note, v.is_active, v.id,
                       v.created_at, v.updated_at, v.deleted_at
                FROM grocery_vendors v
                WHERE NOT EXISTS (SELECT 1 FROM vendor_contacts c WHERE c.legacy_grocery_vendor_id = v.id)
                """
            )
        )

    if has("grocery_items") and has("grocery_list_items"):
        bind.execute(
            text(
                """
                INSERT INTO grocery_list_items (
                    id, family_id, list_id, item_id, created_by_member_id, name, qty, unit, unit_price,
                    is_bought, bought_by, barcode, category, mobile_sync_key, legacy_grocery_item_id,
                    created_at, updated_at, deleted_at
                )
                SELECT g.id || '-gli', g.family_id, g.grocery_list_id, NULL, g.created_by_member_id, g.name,
                       g.quantity, g.unit, COALESCE(g.actual_price, g.estimated_price, 0), g.is_bought, NULL,
                       g.barcode, g.category, g.mobile_sync_key, g.id, g.created_at, g.updated_at, g.deleted_at
                FROM grocery_items g
                WHERE NOT EXISTS (SELECT 1 FROM grocery_list_items l WHERE l.legacy_grocery_item_id = g.id)
                """
            )
        )

    if has("transactions") and has("loans") and has("loan_payments"):
        bind.execute(
            text(
                """
                INSERT INTO loan_payments (id, loan_id, family_id, amount, payment_date, notes, payment_method, transaction_id, created_at, updated_at, deleted_at)
                SELECT t.id || '-lp', t.loan_id, t.family_id, t.amount, COALESCE(CAST(t.created_at AS CHAR), ''), NULL, NULL, t.id,
                       t.created_at, t.updated_at, t.deleted_at
                FROM transactions t
                WHERE t.loan_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM loan_payments p WHERE p.transaction_id = t.id)
                """
            )
        )

    if has("phase15_items") and has("investments"):
        bind.execute(
            text(
                """
                INSERT INTO investments (id, family_id, created_by_member_id, member_id, type, name, principal, rate, start_date, maturity, currency, status, note, legacy_phase15_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-inv', p.family_id, p.created_by_member_id, p.member_id, COALESCE(p.sub_type, p.category, 'GENERAL'), p.name,
                       p.amount, p.secondary_amount, p.secondary_date, p.target_date, p.currency, p.status, p.note, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM phase15_items p
                WHERE UPPER(p.module_type) = 'INVESTMENT'
                  AND NOT EXISTS (SELECT 1 FROM investments i WHERE i.legacy_phase15_id = p.id)
                """
            )
        )
        bind.execute(
            text(
                """
                INSERT INTO health_expenses (id, family_id, created_by_member_id, member_id, type, doctor, amount, expense_date, currency, notes, status, legacy_phase15_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-he', p.family_id, p.created_by_member_id, p.member_id, COALESCE(p.sub_type, p.category, 'GENERAL'), p.provider,
                       p.amount, COALESCE(p.target_date, p.secondary_date), p.currency, p.note, p.status, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM phase15_items p
                WHERE UPPER(p.module_type) = 'HEALTH'
                  AND NOT EXISTS (SELECT 1 FROM health_expenses h WHERE h.legacy_phase15_id = p.id)
                """
            )
        )
        bind.execute(
            text(
                """
                INSERT INTO vehicle_expenses (id, family_id, created_by_member_id, vehicle_name, type, amount, km_reading, expense_date, currency, notes, status, legacy_phase15_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-ve', p.family_id, p.created_by_member_id, p.name, COALESCE(p.sub_type, p.category, 'GENERAL'),
                       p.amount, p.secondary_amount, COALESCE(p.target_date, p.secondary_date), p.currency, p.note, p.status, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM phase15_items p
                WHERE UPPER(p.module_type) = 'VEHICLE'
                  AND NOT EXISTS (SELECT 1 FROM vehicle_expenses v WHERE v.legacy_phase15_id = p.id)
                """
            )
        )

    if has("phase16_items") and has("properties"):
        bind.execute(
            text(
                """
                INSERT INTO properties (id, family_id, created_by_member_id, name, type, value, rent_income, area, location, currency, status, notes, legacy_phase16_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-pr', p.family_id, p.created_by_member_id, p.name, COALESCE(p.sub_type, p.category, 'GENERAL'),
                       p.amount, p.secondary_amount, p.reference, p.provider, p.currency, p.status, p.note, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM phase16_items p
                WHERE UPPER(p.module_type) = 'PROPERTY'
                  AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.legacy_phase16_id = p.id)
                """
            )
        )
        bind.execute(
            text(
                """
                INSERT INTO subscriptions (id, family_id, created_by_member_id, name, amount, cycle, next_due, status, auto_remind, currency, payment_account_id, notes, legacy_phase16_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-su', p.family_id, p.created_by_member_id, p.name, p.amount, COALESCE(p.billing_cycle, 'MONTHLY'),
                       p.renewal_or_expiry_date, p.status, TRUE, p.currency, p.payment_account_id, p.note, p.id,
                       p.created_at, p.updated_at, p.deleted_at
                FROM phase16_items p
                WHERE UPPER(p.module_type) = 'SUBSCRIPTION'
                  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.legacy_phase16_id = p.id)
                """
            )
        )
        bind.execute(
            text(
                """
                INSERT INTO documents (id, family_id, created_by_member_id, member_id, name, type, file_url, expiry_date, encrypted, file_name, file_path, file_mime, file_size, file_sha256, status, notes, legacy_phase16_id, created_at, updated_at, deleted_at)
                SELECT p.id || '-do', p.family_id, p.created_by_member_id, p.member_id, p.name, COALESCE(p.sub_type, p.category, 'GENERAL'),
                       p.file_path, p.renewal_or_expiry_date, p.file_encrypted, p.file_name, p.file_path, p.file_mime, p.file_size, p.file_sha256,
                       p.status, p.note, p.id, p.created_at, p.updated_at, p.deleted_at
                FROM phase16_items p
                WHERE UPPER(p.module_type) = 'DOCUMENT'
                  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.legacy_phase16_id = p.id)
                """
            )
        )

    if has("sync_outbox") and has("sync_queue"):
        bind.execute(
            text(
                """
                INSERT INTO sync_queue (id, device_id, family_id, entity_type, entity_id, action, payload, status, retry_count, last_error, legacy_outbox_id, created_at, updated_at, deleted_at)
                SELECT o.id || '-sq', o.device_id, o.family_id, o.entity_type, o.entity_id, o.operation, o.payload, o.status, 0, o.error_message, o.id,
                       o.created_at, o.updated_at, NULL
                FROM sync_outbox o
                WHERE NOT EXISTS (SELECT 1 FROM sync_queue q WHERE q.legacy_outbox_id = o.id)
                """
            )
        )

    if has("sync_devices") and has("device_registry"):
        # sync_devices has family_id+device_id but no user_id — skip if no user mapping; create fingerprint rows with family only via placeholder user when possible
        pass

    if has("notification_templates"):
        bind.execute(
            text(
                """
                INSERT INTO notification_templates (id, type, title_bn, title_en, body_bn, body_en, variables, created_at, updated_at, deleted_at)
                SELECT 'nt-budget-alert', 'BUDGET_ALERT', 'বাজেট সতর্কতা', 'Budget alert',
                       '{category} বাজেট সীমা অতিক্রম করেছে', '{category} budget exceeded', '["category"]',
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
                WHERE NOT EXISTS (SELECT 1 FROM notification_templates t WHERE t.type = 'BUDGET_ALERT')
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    # Drop only architecture-new tables (keep legacy aliases)
    for table_name in reversed(NEW_TABLES):
        if insp.has_table(table_name):
            op.drop_table(table_name)
