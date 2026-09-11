"""OTP channel fan-out: email always + WhatsApp/SMS for mobile."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.config import settings
from app.services.email_service import is_smtp_configured, send_otp_email
from app.services.sms_service import mobile_channel_status, send_mobile_otp


@dataclass
class OtpDeliveryReport:
    email_sent: bool
    mobile_sent: bool
    mobile_channel: str | None = None
    delivered_via: list[str] = field(default_factory=list)
    email_reason: str = ""
    mobile_reason: str = ""
    ok: bool = False
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "email_sent": self.email_sent,
            "mobile_sent": self.mobile_sent,
            "mobile_channel": self.mobile_channel,
            "delivered_via": list(self.delivered_via),
            "email_reason": self.email_reason,
            "mobile_reason": self.mobile_reason,
            "ok": self.ok,
            "error": self.error,
        }


def can_deliver_otp() -> tuple[bool, str]:
    if not (settings.AUTH_EMAIL_ENABLED and is_smtp_configured()):
        return False, "SMTP not configured — cannot send OTP email"
    mobile = mobile_channel_status()
    if settings.IS_PRODUCTION and not mobile["can_send_mobile"]:
        return False, "WhatsApp/SMS not configured — cannot send mobile OTP"
    return True, "ok"


def send_otp_to_channels(*, email: str, phone: str, otp: str) -> OtpDeliveryReport:
    report = OtpDeliveryReport(email_sent=False, mobile_sent=False)
    email_res = send_otp_email(to_email=email, otp=otp)
    report.email_sent = bool(email_res.sent)
    report.email_reason = email_res.reason
    if email_res.sent:
        report.delivered_via.append("email")

    mobile = mobile_channel_status()
    if mobile["can_send_mobile"]:
        mobile_res = send_mobile_otp(phone=phone, otp=otp)
        report.mobile_sent = bool(mobile_res.sent)
        report.mobile_channel = mobile_res.channel
        report.mobile_reason = mobile_res.reason
        if mobile_res.sent and mobile_res.channel:
            report.delivered_via.append(mobile_res.channel)
    else:
        report.mobile_reason = "WhatsApp/SMS not configured"
        if not settings.IS_PRODUCTION:
            # Dev: email-only OTP allowed
            report.ok = report.email_sent
            if not report.ok:
                report.error = report.email_reason or "OTP email failed"
            return report
        report.ok = False
        report.error = "WhatsApp/SMS not configured"
        return report

    if report.email_sent and report.mobile_sent:
        report.ok = True
        return report
    report.ok = False
    parts = []
    if not report.email_sent:
        parts.append(f"email: {report.email_reason}")
    if not report.mobile_sent:
        parts.append(f"mobile: {report.mobile_reason}")
    report.error = "; ".join(parts) or "OTP delivery failed"
    return report
