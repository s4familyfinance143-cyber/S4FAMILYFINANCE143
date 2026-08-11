"""Smoke test Phase 15/16 expanded modules via TestClient."""

import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.models.user import User


def auth_headers(db) -> tuple[str, dict[str, str]]:
    user = db.query(User).filter(User.email == "test@s4family.com", User.deleted_at.is_(None)).first()
    if not user:
        user = db.query(User).filter(User.deleted_at.is_(None)).order_by(User.created_at.asc()).first()
    if not user:
        raise RuntimeError("No user found for smoke test")
    token = create_access_token(subject=user.id)
    return user.id, {"Authorization": f"Bearer {token}"}


def main() -> int:
    client = TestClient(app)
    db = SessionLocal()
    try:
        _, headers = auth_headers(db)
        families = client.get("/families", headers=headers)
        family_rows = families.json().get("families") if isinstance(families.json(), dict) else families.json()
        if families.status_code != 200 or not family_rows:
            print("FAMILIES FAIL", families.status_code, families.text[:300])
            return 1
        family_id = family_rows[0]["id"]
        members = client.get(f"/families/{family_id}/members", headers=headers)
        member_rows = members.json().get("members") or []
        member_id = (member_rows[0].get("member_id") or member_rows[0].get("id")) if member_rows else None
        due = (date.today() + timedelta(days=7)).isoformat()

        phase15_payloads = [
            {"module_type": "INVESTMENT", "name": "Smoke DPS", "sub_type": "DPS", "amount": "1000", "secondary_date": due, "secondary_amount": "8.5"},
            {"module_type": "HEALTH", "name": "Smoke Doctor", "sub_type": "DOCTOR", "member_id": member_id, "provider": "City Hospital", "amount": "500"},
            {"module_type": "VEHICLE", "name": "Smoke Fuel", "sub_type": "FUEL", "provider": "DHK-1234", "secondary_amount": "12000", "secondary_date": due, "amount": "3000"},
            {"module_type": "EDUCATION", "name": "Smoke School", "sub_type": "SCHOOL_FEE", "member_id": member_id, "provider": "Ideal School", "secondary_amount": "5000", "amount": "5000"},
        ]
        phase16_payloads = [
            {"module_type": "SUBSCRIPTION", "name": "Smoke Netflix", "sub_type": "STREAMING", "billing_cycle": "MONTHLY", "renewal_or_expiry_date": due, "amount": "650"},
            {"module_type": "DOCUMENT", "name": "Smoke Passport", "sub_type": "PASSPORT", "member_id": member_id, "renewal_or_expiry_date": due, "reference": "P123456"},
            {"module_type": "PROPERTY", "name": "Smoke House", "sub_type": "HOUSE", "provider": "Dhaka", "secondary_amount": "4200000", "amount": "18000"},
        ]

        created15 = []
        for payload in phase15_payloads:
            body = {"family_id": family_id, "category": "GENERAL", "currency": "BDT", **payload}
            res = client.post("/phase15", json=body, headers=headers)
            print("P15 CREATE", payload["module_type"], res.status_code)
            if res.status_code not in (200, 201):
                print(res.text[:300])
                return 1
            created15.append(res.json())

        created16 = []
        for payload in phase16_payloads:
            body = {"family_id": family_id, "category": "GENERAL", "currency": "BDT", **payload}
            res = client.post("/phase16", json=body, headers=headers)
            print("P16 CREATE", payload["module_type"], res.status_code)
            if res.status_code not in (200, 201):
                print(res.text[:300])
                return 1
            created16.append(res.json())

        s15 = client.get(f"/phase15/summary/{family_id}", headers=headers)
        s16 = client.get(f"/phase16/summary/{family_id}", headers=headers)
        print("P15 SUMMARY upcoming", len(s15.json().get("upcoming", [])))
        print("P16 SUMMARY monthly", s16.json().get("modules", {}).get("SUBSCRIPTION", {}).get("monthly_cost_total"))

        patch15 = client.patch(
            f"/phase15/{created15[0]['id']}",
            json={"family_id": family_id, "name": "Smoke DPS Updated", "category": "GENERAL", "sub_type": "DPS", "amount": "1200"},
            headers=headers,
        )
        print("P15 PATCH", patch15.status_code)

        patch16 = client.patch(
            f"/phase16/{created16[0]['id']}",
            json={
                "family_id": family_id,
                "name": "Smoke Netflix Updated",
                "category": "GENERAL",
                "sub_type": "STREAMING",
                "billing_cycle": "YEARLY",
                "renewal_or_expiry_date": due,
                "amount": "7800",
            },
            headers=headers,
        )
        print("P16 PATCH", patch16.status_code)

        print("PASS")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
