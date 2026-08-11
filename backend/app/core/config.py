import os
from pathlib import Path

from pydantic import computed_field, model_validator, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_DEV_JWT_SECRET = (
    "local_" + "development_" + "jwt_" + "secret_" + "key_" + "not_for_production"
)


class Settings(BaseSettings):

    # === FINAL RELEASE JWT_SECRET_KEY ENV OVERRIDE VALIDATOR ===
    @field_validator("JWT_SECRET_KEY", mode="before")
    @classmethod
    def _final_release_jwt_secret_key_env_override(cls, value):
        return (
            os.getenv("JWT_SECRET_KEY")
            or os.getenv("JWT_SECRET")
            or os.getenv("SECRET_KEY")
            or os.getenv("APP_SECRET_KEY")
            or os.getenv("S4_JWT_SECRET_KEY")
            or os.getenv("S4_SECRET_KEY")
            or value
        )
    # === END FINAL RELEASE JWT_SECRET_KEY ENV OVERRIDE VALIDATOR ===

    APP_NAME: str = "S4 FAMILY FINANCE"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = "sqlite:///./s4_family_finance_dev.db"

    DATABASE_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_RECYCLE_SECONDS: int = 1800

    JWT_SECRET_KEY: str = Field(default_factory=lambda: os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or os.getenv("APP_SECRET_KEY") or os.getenv("S4_JWT_SECRET_KEY") or os.getenv("S4_SECRET_KEY") or DEFAULT_DEV_JWT_SECRET)
    # Architecture: RS256 access tokens (15 min). PEM keys via env or auto-generated secrets/.
    JWT_ALGORITHM: str = "RS256"
    JWT_PRIVATE_KEY: str | None = None
    JWT_PUBLIC_KEY: str | None = None

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    BCRYPT_ROUNDS: int = 12
    REFRESH_COOKIE_NAME: str = "s4_refresh_token"
    REFRESH_COOKIE_SECURE: bool = False  # True in production validator
    REFRESH_COOKIE_SAMESITE: str = "lax"
    FIELD_ENCRYPTION_KEY: str | None = None  # 32-byte urlsafe base64 for AES-256-GCM

    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30
    EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS: int = 24
    FAILED_LOGIN_MAX_ATTEMPTS: int = 5
    FAILED_LOGIN_LOCK_MINUTES: int = 15
    AUTH_REFRESH_TOKEN_BYTES: int = 48

    AUTO_CREATE_TABLES: bool = True

    ENABLE_RECURRING_WORKER: bool = True
    ENABLE_AUTO_BACKUP_WORKER: bool = True

    NOTIFICATION_IN_APP_ENABLED: bool = True
    NOTIFICATION_FCM_ENABLED: bool = False
    NOTIFICATION_EMAIL_ENABLED: bool = False
    AUTH_EMAIL_ENABLED: bool = True
    FCM_PROJECT_ID: str | None = None
    FCM_CREDENTIALS_PATH: str | None = None

    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_EMAIL: str | None = None
    SMTP_FROM_NAME: str = "S4 Family Finance"
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False
    APP_PUBLIC_URL: str = "http://127.0.0.1:5173"

    SENTRY_DSN: str | None = None
    SENTRY_ENVIRONMENT: str | None = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    REDIS_URL: str | None = None
    CELERY_ENABLED: bool = False
    GOOGLE_VISION_ENABLED: bool = False
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None
    S3_ENDPOINT_URL: str | None = None
    S3_BUCKET: str | None = None
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None
    DOCUMENT_VAULT_BACKEND: str = "auto"  # auto | local | s3

    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ]

    @computed_field
    @property
    def IS_SQLITE(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @computed_field
    @property
    def IS_POSTGRESQL(self) -> bool:
        return self.DATABASE_URL.startswith("postgresql")

    @computed_field
    @property
    def IS_PRODUCTION(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @model_validator(mode="after")
    def validate_production_safety(self):
        if not self.IS_PRODUCTION:
            return self

        if self.IS_SQLITE:
            raise ValueError(
                "Production safety error: ENVIRONMENT=production cannot use SQLite. "
                "Set DATABASE_URL to PostgreSQL."
            )

        if not self.IS_POSTGRESQL:
            raise ValueError(
                "Production safety error: DATABASE_URL must use PostgreSQL."
            )

        if self.AUTO_CREATE_TABLES:
            raise ValueError(
                "Production safety error: AUTO_CREATE_TABLES must be false. "
                "Use Alembic migrations in production."
            )

        if self.JWT_SECRET_KEY == DEFAULT_DEV_JWT_SECRET:
            raise ValueError(
                "Production safety error: JWT_SECRET_KEY must be changed before production."
            )

        if len(self.JWT_SECRET_KEY) < 32:
            raise ValueError(
                "Production safety error: JWT_SECRET_KEY must be at least 32 characters."
            )

        if (self.JWT_ALGORITHM or "").upper().startswith("RS"):
            has_inline = bool(
                (self.JWT_PRIVATE_KEY or "").strip() and (self.JWT_PUBLIC_KEY or "").strip()
            )
            keys_mounted = (os.getenv("JWT_RSA_KEYS_MOUNTED") or "").strip().lower() in {
                "1",
                "true",
                "yes",
            }
            secrets_dir = Path(__file__).resolve().parents[2] / "secrets"
            has_files = (
                keys_mounted
                and (secrets_dir / "jwt_rs256_private.pem").is_file()
                and (secrets_dir / "jwt_rs256_public.pem").is_file()
            )
            if not (has_inline or has_files):
                raise ValueError(
                    "Production safety error: RS256 requires JWT_PRIVATE_KEY + JWT_PUBLIC_KEY "
                    "(or mount PEMs and set JWT_RSA_KEYS_MOUNTED=true). "
                    "Or set JWT_ALGORITHM=HS256 and use JWT_SECRET_KEY only."
                )
            object.__setattr__(self, "REFRESH_COOKIE_SECURE", True)
        else:
            object.__setattr__(self, "REFRESH_COOKIE_SECURE", True)

        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
