"""Relationship taxonomy + serial rules (separate from security roles)."""

from __future__ import annotations

from fastapi import HTTPException

# group -> allowed relationship labels (EN)
RELATIONSHIP_GROUPS: dict[str, list[str]] = {
    "SPOUSE": ["Husband", "Wife"],
    "CHILDREN": ["Son", "Daughter"],
    "IN_LAW": ["Son's Wife", "Daughter's Husband"],
    "PARENTS": ["Father", "Mother"],
    "SIBLINGS": ["Brother", "Sister", "Elder Brother", "Elder Sister"],
    "GUARDIAN_OTHER": ["Guardian", "Relative", "Other"],
}

OWNER_RESPONSIBLE_TYPES = [
    "Husband",
    "Wife",
    "Father",
    "Mother",
    "Elder Brother",
    "Elder Sister",
    "Guardian",
    "Other",
]

# serial labels → rank integers
CHILDREN_SERIAL = {
    "ELDER": 1,
    "SECOND": 2,
    "THIRD": 3,
    "YOUNGEST": 9,
    "CUSTOM": 5,
}

SIBLING_SERIAL = {
    "ELDER": 1,
    "YOUNGER": 2,
    "CUSTOM": 5,
}

NO_SERIAL_GROUPS = {"SPOUSE", "PARENTS"}
REQUIRES_NOTE_GROUPS = {"GUARDIAN_OTHER"}
REQUIRES_LINK_GROUPS = {"IN_LAW"}


def group_for_label(label: str | None) -> str | None:
    name = (label or "").strip()
    for group, labels in RELATIONSHIP_GROUPS.items():
        if name in labels:
            return group
    return None


def resolve_serial_rank(group: str | None, serial_label: str | None, serial_int: int | None) -> int | None:
    if group in NO_SERIAL_GROUPS:
        return None
    if group == "CHILDREN":
        if serial_label:
            key = serial_label.strip().upper()
            if key not in CHILDREN_SERIAL:
                raise HTTPException(422, f"Invalid children serial: {serial_label}")
            if key == "CUSTOM":
                if serial_int is None:
                    raise HTTPException(422, "Custom children serial requires relationship_serial integer")
                return int(serial_int)
            return CHILDREN_SERIAL[key]
        return serial_int
    if group == "SIBLINGS":
        if serial_label:
            key = serial_label.strip().upper()
            if key not in SIBLING_SERIAL:
                raise HTTPException(422, f"Invalid sibling serial: {serial_label}")
            if key == "CUSTOM":
                if serial_int is None:
                    raise HTTPException(422, "Custom sibling serial requires relationship_serial integer")
                return int(serial_int)
            return SIBLING_SERIAL[key]
        return serial_int
    return serial_int


def validate_relationship_payload(
    *,
    relationship_label: str | None,
    relationship_serial: int | None = None,
    serial_label: str | None = None,
    linked_member_id: str | None = None,
    relationship_note: str | None = None,
    allow_owner_responsible: bool = False,
) -> dict:
    label = (relationship_label or "").strip()
    if not label:
        raise HTTPException(422, "relationship_type / label required")

    group = group_for_label(label)
    if allow_owner_responsible and label in OWNER_RESPONSIBLE_TYPES:
        group = group or ("SIBLINGS" if "Brother" in label or "Sister" in label else "GUARDIAN_OTHER" if label in {"Guardian", "Other"} else "SPOUSE" if label in {"Husband", "Wife"} else "PARENTS")
    if not group:
        # still allow free-form but classify as GUARDIAN_OTHER
        group = "GUARDIAN_OTHER"

    if group in NO_SERIAL_GROUPS and (relationship_serial is not None or (serial_label or "").strip()):
        raise HTTPException(422, f"{label} does not use relationship serial")

    if group in REQUIRES_NOTE_GROUPS and not (relationship_note or "").strip():
        raise HTTPException(422, "Guardian/Other requires a manual relationship note")

    if group in REQUIRES_LINK_GROUPS and not linked_member_id:
        raise HTTPException(422, "In-law relationship requires linked_member_id (child/member)")

    rank = resolve_serial_rank(group, serial_label, relationship_serial)
    display = label
    if serial_label:
        display = f"{label} ({serial_label.title()})"
    elif rank is not None:
        display = f"{label} #{rank}"

    return {
        "group": group,
        "label": label,
        "relationship_serial": rank,
        "relationship_display_label": display,
        "linked_member_id": linked_member_id,
        "relationship_note": (relationship_note or "").strip() or None,
    }
