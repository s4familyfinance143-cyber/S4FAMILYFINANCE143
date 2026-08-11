"""Real SMTP email delivery (no fake send).

If SMTP is not configured, returns sent=False with an honest reason.
Never pretends an email was delivered.
"""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import settings


@dataclass
class EmailSendResult:
    sent: bool
    reason: str
    to_email: str | None = None
    subject: str | None = None

    def as_dict(self) -> dict:
        return {
            "sent": self.sent,
            "reason": self.reason,
            "to_email": self.to_email,
            "subject": self.subject,
        }


def smtp_status() -> dict:
    host = (settings.SMTP_HOST or "").strip()
    from_email = (settings.SMTP_FROM_EMAIL or "").strip()
    configured = bool(host and from_email)
    return {
        "configured": configured,
        "host": host or None,
        "port": settings.SMTP_PORT,
        "from_email": from_email or None,
        "from_name": settings.SMTP_FROM_NAME,
        "use_tls": bool(settings.SMTP_USE_TLS),
        "use_ssl": bool(settings.SMTP_USE_SSL),
        "username_set": bool((settings.SMTP_USERNAME or "").strip()),
        "notification_email_enabled": bool(settings.NOTIFICATION_EMAIL_ENABLED),
        "auth_email_enabled": bool(settings.AUTH_EMAIL_ENABLED),
        "app_public_url": settings.APP_PUBLIC_URL,
    }


def is_smtp_configured() -> bool:
    return bool((settings.SMTP_HOST or "").strip() and (settings.SMTP_FROM_EMAIL or "").strip())


def send_email(*, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> EmailSendResult:
    to_email = str(to_email or "").strip().lower()
    subject = str(subject or "").strip()
    if not to_email:
        return EmailSendResult(False, "Recipient email missing")
    if not subject:
        return EmailSendResult(False, "Subject missing")
    if not is_smtp_configured():
        return EmailSendResult(False, "SMTP not configured", to_email=to_email, subject=subject)

    host = settings.SMTP_HOST.strip()
    port = int(settings.SMTP_PORT or 587)
    from_email = settings.SMTP_FROM_EMAIL.strip()
    from_name = (settings.SMTP_FROM_NAME or "S4 Family Finance").strip()
    username = (settings.SMTP_USERNAME or "").strip() or None
    password = settings.SMTP_PASSWORD or None

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = to_email
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        if settings.SMTP_USE_SSL:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as smtp:
                if username and password:
                    smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                smtp.ehlo()
                if settings.SMTP_USE_TLS:
                    context = ssl.create_default_context()
                    smtp.starttls(context=context)
                    smtp.ehlo()
                if username and password:
                    smtp.login(username, password)
                smtp.send_message(message)
    except Exception as exc:  # noqa: BLE001 - surface real SMTP failure honestly
        return EmailSendResult(False, f"SMTP send failed: {exc}", to_email=to_email, subject=subject)

    return EmailSendResult(True, "sent", to_email=to_email, subject=subject)


def send_password_reset_email(*, to_email: str, token: str) -> EmailSendResult:
    if not settings.AUTH_EMAIL_ENABLED:
        return EmailSendResult(False, "Auth email disabled", to_email=to_email, subject="Password reset")
    base = (settings.APP_PUBLIC_URL or "http://127.0.0.1:5173").rstrip("/")
    link = f"{base}/?reset_token={token}"
    subject = "S4 Family Finance — Password reset"
    text = (
        "You requested a password reset for S4 Family Finance.\n\n"
        f"Reset token:\n{token}\n\n"
        f"Open this link (or paste the token in the app):\n{link}\n\n"
        "If you did not request this, ignore this email."
    )
    html = (
        "<p>You requested a password reset for <strong>S4 Family Finance</strong>.</p>"
        f"<p><code>{token}</code></p>"
        f'<p><a href="{link}">Reset password</a></p>'
        "<p>If you did not request this, ignore this email.</p>"
    )
    return send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)


def send_email_verification_email(*, to_email: str, token: str) -> EmailSendResult:
    if not settings.AUTH_EMAIL_ENABLED:
        return EmailSendResult(False, "Auth email disabled", to_email=to_email, subject="Email verification")
    base = (settings.APP_PUBLIC_URL or "http://127.0.0.1:5173").rstrip("/")
    link = f"{base}/?verify_token={token}"
    subject = "S4 Family Finance — Verify your email"
    text = (
        "Verify your email for S4 Family Finance.\n\n"
        f"Verification token:\n{token}\n\n"
        f"Open this link:\n{link}\n"
    )
    html = (
        "<p>Verify your email for <strong>S4 Family Finance</strong>.</p>"
        f"<p><code>{token}</code></p>"
        f'<p><a href="{link}">Verify email</a></p>'
    )
    return send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)


def send_notification_email(*, to_email: str, title: str, message: str) -> EmailSendResult:
    if not settings.NOTIFICATION_EMAIL_ENABLED:
        return EmailSendResult(False, "Notification email disabled", to_email=to_email, subject=title)
    subject = f"S4 Family Finance — {title}"
    text = f"{title}\n\n{message}\n"
    html = f"<h3>{title}</h3><p>{message}</p>"
    return send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)
