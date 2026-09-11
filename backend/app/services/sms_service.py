"""Mobile OTP delivery: WhatsApp preferred when configured, else SMS."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from app.core.config import settings


@dataclass
class MobileSendResult:
    sent: bool
    channel: str | None  # whatsapp | sms
    reason: str

    def as_dict(self) -> dict:
        return {"sent": self.sent, "channel": self.channel, "reason": self.reason}


def normalize_bd_phone(raw: str) -> str:
    """Normalize BD local numbers to E.164 (+880...)."""
    digits = re.sub(r"\D+", "", str(raw or ""))
    if digits.startswith("880") and len(digits) >= 13:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) == 11:
        return f"+880{digits[1:]}"
    if len(digits) == 10 and digits.startswith("1"):
        return f"+880{digits}"
    if str(raw or "").strip().startswith("+") and len(digits) >= 10:
        return f"+{digits}"
    return f"+{digits}" if digits else ""


def is_whatsapp_configured() -> bool:
    provider = (settings.WHATSAPP_PROVIDER or "").strip().lower()
    if provider == "meta":
        return bool((settings.WHATSAPP_TOKEN or "").strip() and (settings.WHATSAPP_PHONE_NUMBER_ID or "").strip())
    if provider == "twilio":
        return bool(
            (settings.TWILIO_ACCOUNT_SID or "").strip()
            and (settings.TWILIO_AUTH_TOKEN or "").strip()
            and (settings.TWILIO_WHATSAPP_FROM or "").strip()
        )
    return False


def is_sms_configured() -> bool:
    provider = (settings.SMS_PROVIDER or "").strip().lower()
    if provider == "console":
        return True
    if provider == "http":
        return bool((settings.SMS_API_URL or "").strip() and (settings.SMS_API_KEY or "").strip())
    if provider == "twilio":
        return bool(
            (settings.TWILIO_ACCOUNT_SID or "").strip()
            and (settings.TWILIO_AUTH_TOKEN or "").strip()
            and (settings.TWILIO_SMS_FROM or "").strip()
        )
    return False


def mobile_channel_status() -> dict:
    wa = is_whatsapp_configured()
    sms = is_sms_configured()
    preferred = "whatsapp" if wa else ("sms" if sms else None)
    return {
        "whatsapp_configured": wa,
        "sms_configured": sms,
        "preferred_mobile_channel": preferred,
        "can_send_mobile": bool(preferred),
    }


def _http_json(url: str, payload: dict, *, headers: dict | None = None, method: str = "POST") -> tuple[bool, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data if method.upper() != "GET" else None,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if 200 <= int(resp.status) < 300:
                return True, body[:300] or "ok"
            return False, f"HTTP {resp.status}: {body[:200]}"
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return False, f"HTTP {exc.code}: {body[:200]}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _send_whatsapp(phone_e164: str, otp: str) -> MobileSendResult:
    provider = (settings.WHATSAPP_PROVIDER or "").strip().lower()
    if provider == "meta":
        phone_id = (settings.WHATSAPP_PHONE_NUMBER_ID or "").strip()
        token = (settings.WHATSAPP_TOKEN or "").strip()
        url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
        # Prefer template (production); fall back to text for sandbox/dev.
        template = (settings.WHATSAPP_TEMPLATE_NAME or "").strip()
        if template:
            payload = {
                "messaging_product": "whatsapp",
                "to": phone_e164.lstrip("+"),
                "type": "template",
                "template": {
                    "name": template,
                    "language": {"code": settings.WHATSAPP_TEMPLATE_LANG or "en"},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [{"type": "text", "text": otp}],
                        }
                    ],
                },
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "to": phone_e164.lstrip("+"),
                "type": "text",
                "text": {"body": f"S4 Family Finance OTP: {otp}"},
            }
        ok, reason = _http_json(url, payload, headers={"Authorization": f"Bearer {token}"})
        return MobileSendResult(ok, "whatsapp" if ok else None, reason if ok else f"WhatsApp Meta failed: {reason}")

    if provider == "twilio":
        sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (settings.TWILIO_AUTH_TOKEN or "").strip()
        from_wa = (settings.TWILIO_WHATSAPP_FROM or "").strip()
        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        form = urllib.parse.urlencode(
            {
                "From": from_wa,
                "To": f"whatsapp:{phone_e164}",
                "Body": f"S4 Family Finance OTP: {otp}",
            }
        ).encode("utf-8")
        req = urllib.request.Request(url, data=form, method="POST")
        auth = urllib.request._HTTPPasswordMgrWithDefaultRealm()  # type: ignore[attr-defined]
        # Basic auth via header
        import base64

        basic = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {basic}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if 200 <= int(resp.status) < 300:
                    return MobileSendResult(True, "whatsapp", "ok")
                return MobileSendResult(False, None, f"Twilio WhatsApp HTTP {resp.status}")
        except Exception as exc:  # noqa: BLE001
            return MobileSendResult(False, None, f"Twilio WhatsApp failed: {exc}")

    return MobileSendResult(False, None, "WhatsApp not configured")


def _send_sms(phone_e164: str, otp: str) -> MobileSendResult:
    provider = (settings.SMS_PROVIDER or "").strip().lower()
    body = f"S4 Family Finance OTP: {otp}"
    if provider == "console":
        # Ops/testing fallback until real WhatsApp/SMS credentials are set.
        print(f"[s4-otp-sms-console] to={phone_e164} otp={otp}", flush=True)
        return MobileSendResult(True, "sms", "console-logged")
    if provider == "http":
        url = (settings.SMS_API_URL or "").strip()
        key = (settings.SMS_API_KEY or "").strip()
        sender = (settings.SMS_SENDER_ID or "").strip() or "S4FAMILY"
        method = (settings.SMS_HTTP_METHOD or "POST").strip().upper()
        payload = {
            "api_key": key,
            "to": phone_e164,
            "phone": phone_e164,
            "message": body,
            "text": body,
            "sender": sender,
            "sender_id": sender,
        }
        ok, reason = _http_json(url, payload, method=method)
        return MobileSendResult(ok, "sms" if ok else None, reason if ok else f"SMS HTTP failed: {reason}")

    if provider == "twilio":
        sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (settings.TWILIO_AUTH_TOKEN or "").strip()
        from_sms = (settings.TWILIO_SMS_FROM or "").strip()
        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        form = urllib.parse.urlencode({"From": from_sms, "To": phone_e164, "Body": body}).encode("utf-8")
        req = urllib.request.Request(url, data=form, method="POST")
        import base64

        basic = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {basic}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if 200 <= int(resp.status) < 300:
                    return MobileSendResult(True, "sms", "ok")
                return MobileSendResult(False, None, f"Twilio SMS HTTP {resp.status}")
        except Exception as exc:  # noqa: BLE001
            return MobileSendResult(False, None, f"Twilio SMS failed: {exc}")

    return MobileSendResult(False, None, "SMS not configured")


def send_mobile_otp(*, phone: str, otp: str) -> MobileSendResult:
    phone_e164 = normalize_bd_phone(phone)
    if not phone_e164 or len(re.sub(r"\D+", "", phone_e164)) < 10:
        return MobileSendResult(False, None, "Invalid phone number")
    if is_whatsapp_configured():
        return _send_whatsapp(phone_e164, otp)
    if is_sms_configured():
        return _send_sms(phone_e164, otp)
    return MobileSendResult(False, None, "WhatsApp/SMS not configured")
