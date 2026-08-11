from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

text = text.replace(
    '"member_name": getattr(member, "display_name", None),',
    '"member_name": member.user.full_name if member.user else None,'
)

text = text.replace(
    '"role": getattr(member, "role_name", None),',
    '"role": member.role,'
)

text = text.replace(
    '"role": member.role,',
    '"role": member.role,\n                "relationship": member.relationship_display_label,',
    1
)

p.write_text(text, encoding="utf-8")
print("MEMBER REPORT NAME ROLE FIX OK")
