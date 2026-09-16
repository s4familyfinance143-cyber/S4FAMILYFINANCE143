"""Coverage for otp_delivery.send_otp_to_channels' success criterion.

A transient WhatsApp/SMS provider failure must not block signup/login/delete
when the email OTP itself was delivered -- the user still has a working code.
"""

from __future__ import annotations

from app.services import otp_delivery


def test_send_otp_to_channels_ok_when_email_succeeds_and_mobile_fails(monkeypatch):
    monkeypatch.setattr(otp_delivery, "send_otp_email", lambda *, to_email, otp: _Result(True, "sent"))
    monkeypatch.setattr(
        otp_delivery, "mobile_channel_status", lambda: {"can_send_mobile": True, "preferred_mobile_channel": "sms"}
    )
    monkeypatch.setattr(
        otp_delivery,
        "send_mobile_otp",
        lambda *, phone, otp: _Result(False, "provider timeout", channel=None),
    )

    report = otp_delivery.send_otp_to_channels(email="a@example.com", phone="01712345678", otp="123456")

    assert report.ok is True
    assert report.email_sent is True
    assert report.mobile_sent is False
    assert report.delivered_via == ["email"]
    assert "email" in report.mobile_reason or report.mobile_reason == "provider timeout"


def test_send_otp_to_channels_ok_when_mobile_succeeds_and_email_fails(monkeypatch):
    monkeypatch.setattr(otp_delivery, "send_otp_email", lambda *, to_email, otp: _Result(False, "smtp down"))
    monkeypatch.setattr(
        otp_delivery, "mobile_channel_status", lambda: {"can_send_mobile": True, "preferred_mobile_channel": "sms"}
    )
    monkeypatch.setattr(
        otp_delivery, "send_mobile_otp", lambda *, phone, otp: _Result(True, "sent", channel="sms")
    )

    report = otp_delivery.send_otp_to_channels(email="a@example.com", phone="01712345678", otp="123456")

    assert report.ok is True
    assert report.delivered_via == ["sms"]


def test_send_otp_to_channels_fails_when_both_channels_fail(monkeypatch):
    monkeypatch.setattr(otp_delivery, "send_otp_email", lambda *, to_email, otp: _Result(False, "smtp down"))
    monkeypatch.setattr(
        otp_delivery, "mobile_channel_status", lambda: {"can_send_mobile": True, "preferred_mobile_channel": "sms"}
    )
    monkeypatch.setattr(
        otp_delivery, "send_mobile_otp", lambda *, phone, otp: _Result(False, "provider timeout", channel=None)
    )

    report = otp_delivery.send_otp_to_channels(email="a@example.com", phone="01712345678", otp="123456")

    assert report.ok is False
    assert report.delivered_via == []
    assert "email" in report.error and "mobile" in report.error


class _Result:
    def __init__(self, sent: bool, reason: str, channel: str | None = None):
        self.sent = sent
        self.reason = reason
        self.channel = channel
