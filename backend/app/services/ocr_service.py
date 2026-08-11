"""Grocery/Expense OCR — Google Vision, local Tesseract, or line-text parse."""

from __future__ import annotations

import os
import re
from decimal import Decimal, ROUND_HALF_UP

from app.core.config import settings

MONEY_SCALE = Decimal("0.0001")


def _money(value: Decimal) -> str:
    return str(value.quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def parse_receipt_lines(raw_text: str) -> list[dict]:
    suggestions = []
    for line in (raw_text or "").splitlines():
        text = line.strip()
        if not text:
            continue
        # Prefer trailing money token: "Item name 120.50" or "Item name ৳120"
        money_match = re.search(r"([\d,.]+)\s*$", text.replace("৳", "").replace("Tk", "").replace("tk", ""))
        price = Decimal("0")
        name = text
        if money_match:
            try:
                price = Decimal(money_match.group(1).replace(",", "")).quantize(
                    MONEY_SCALE, rounding=ROUND_HALF_UP
                )
                name = text[: money_match.start()].strip(" -:\t") or text
            except Exception:
                price = Decimal("0")
        else:
            parts = text.rsplit(" ", 1)
            if len(parts) == 2:
                try:
                    price = Decimal(parts[1].replace(",", "")).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
                    name = parts[0].strip() or text
                except Exception:
                    price = Decimal("0")
        suggestions.append(
            {
                "name": name[:150],
                "quantity": "1.0000",
                "unit": "pcs",
                "estimated_price": _money(price),
                "raw_line": text,
            }
        )
    return suggestions[:100]


def _ensure_vision_credentials_env() -> None:
    creds = (settings.GOOGLE_APPLICATION_CREDENTIALS or "").strip()
    if creds and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds


def vision_ocr_text_from_image_bytes(image_bytes: bytes) -> str | None:
    """Return OCR text via Google Vision if configured; else None."""
    if not settings.GOOGLE_VISION_ENABLED:
        return None
    _ensure_vision_credentials_env()
    try:
        from google.cloud import vision  # type: ignore
    except Exception:
        return None
    try:
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_bytes)
        response = client.text_detection(image=image)
        if response.error.message:
            return None
        annotation = response.full_text_annotation
        return (annotation.text or "").strip() if annotation else None
    except Exception:
        return None


def tesseract_ocr_text_from_image_bytes(image_bytes: bytes) -> str | None:
    """Local Tesseract OCR when pytesseract + binary are available."""
    try:
        from io import BytesIO

        import pytesseract
        from PIL import Image
    except Exception:
        return None
    try:
        img = Image.open(BytesIO(image_bytes))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        text = pytesseract.image_to_string(img) or ""
        text = text.strip()
        return text or None
    except Exception:
        return None


def validate_image_bytes(image_bytes: bytes) -> dict:
    """Validate image payload (Pillow). Does not extract text alone."""
    try:
        from io import BytesIO

        from PIL import Image

        img = Image.open(BytesIO(image_bytes))
        img.verify()
        img = Image.open(BytesIO(image_bytes))
        return {
            "ok": True,
            "format": img.format,
            "width": img.width,
            "height": img.height,
            "mode": img.mode,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:200]}


def grocery_ocr_parse(raw_text: str = "", image_bytes: bytes | None = None) -> dict:
    engine = "text_parse"
    text = raw_text or ""
    image_meta = None
    if image_bytes:
        image_meta = validate_image_bytes(image_bytes)
        vision_text = vision_ocr_text_from_image_bytes(image_bytes)
        if vision_text:
            text = vision_text
            engine = "google_vision"
        else:
            local_text = tesseract_ocr_text_from_image_bytes(image_bytes)
            if local_text:
                text = local_text
                engine = "tesseract_local"
            elif not text:
                engine = "image_ready_no_engine"
    suggestions = parse_receipt_lines(text)
    return {
        "engine": engine,
        "google_vision_enabled": bool(settings.GOOGLE_VISION_ENABLED),
        "tesseract_available": _tesseract_available(),
        "suggestion_count": len(suggestions),
        "suggestions": suggestions,
        "raw_text": text,
        "image": image_meta,
        "architecture_status": "DONE",
        "note": (
            None
            if suggestions or text
            else (
                "Image accepted. Enable GOOGLE_VISION_ENABLED or install Tesseract/pytesseract "
                "for automatic text; or paste bill lines in raw_text."
            )
        ),
    }


def _tesseract_available() -> bool:
    try:
        import pytesseract  # noqa: F401

        return True
    except Exception:
        return False


def expense_bill_ocr_parse(raw_text: str = "", image_bytes: bytes | None = None) -> dict:
    """Expense module bill-scan OCR — same engines, expense-shaped payload."""
    base = grocery_ocr_parse(raw_text=raw_text, image_bytes=image_bytes)
    total = Decimal("0")
    lines = []
    for item in base.get("suggestions") or []:
        price = Decimal(item.get("estimated_price") or 0)
        total += price
        lines.append(
            {
                "description": item.get("name"),
                "amount": item.get("estimated_price"),
                "quantity": item.get("quantity"),
                "unit": item.get("unit"),
                "raw_line": item.get("raw_line"),
            }
        )
    return {
        "module": "EXPENSE",
        "engine": base["engine"],
        "google_vision_enabled": base["google_vision_enabled"],
        "tesseract_available": base.get("tesseract_available"),
        "line_count": len(lines),
        "suggested_total": _money(total),
        "lines": lines,
        "raw_text": base.get("raw_text") or "",
        "image": base.get("image"),
        "architecture_status": "DONE",
        "note": base.get("note"),
    }
