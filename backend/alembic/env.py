"""Alembic environment for S4 FAMILY FINANCE 143.

This file avoids writing DATABASE_URL into alembic.ini/configparser.
Reason: PostgreSQL passwords with URL-encoded characters like %40 can break
ConfigParser interpolation. SQLAlchemy receives settings.DATABASE_URL directly.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings
from app.models.base import Base

# Import all model modules so Base.metadata is fully populated.
import app.models.auth_session  # noqa: F401

import app.models.account  # noqa: F401
import app.models.audit_log  # noqa: F401
import app.models.budget  # noqa: F401
import app.models.category  # noqa: F401
import app.models.currency  # noqa: F401
import app.models.family  # noqa: F401
import app.models.family_member  # noqa: F401
import app.models.goal  # noqa: F401
import app.models.invite_code  # noqa: F401
import app.models.join_request  # noqa: F401
import app.models.loan  # noqa: F401
import app.models.member_permission  # noqa: F401
import app.models.notification  # noqa: F401
import app.models.push_device  # noqa: F401
import app.models.recurring  # noqa: F401
import app.models.relationship_type  # noqa: F401
import app.models.savings  # noqa: F401
import app.models.transaction  # noqa: F401
import app.models.transaction_line  # noqa: F401
import app.models.user  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        settings.DATABASE_URL,
        poolclass=pool.NullPool,
        future=True,
    )

    with connectable.connect() as connection:
        # Project revision ids can exceed Alembic's default VARCHAR(32), e.g.
        # "0007_grocery_sync_conflict_fields". Widen before upgrade on Postgres.
        if settings.IS_POSTGRESQL:
            from sqlalchemy import text

            connection.execute(
                text(
                    """
                    DO $$
                    BEGIN
                      IF to_regclass('public.alembic_version') IS NULL THEN
                        CREATE TABLE alembic_version (
                          version_num VARCHAR(128) NOT NULL PRIMARY KEY
                        );
                      ELSE
                        ALTER TABLE alembic_version
                          ALTER COLUMN version_num TYPE VARCHAR(128);
                      END IF;
                    END $$;
                    """
                )
            )
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            transaction_per_migration=True,
        )

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
