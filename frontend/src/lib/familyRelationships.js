/** Canonical family relationship labels — keep PC + Mobile identical. */

export const OWNER_RELATIONSHIPS = [
  "Husband",
  "Wife",
  "Father",
  "Mother",
  "Elder Brother",
  "Elder Sister",
  "Guardian",
  "Other",
];

export const JOIN_RELATIONSHIPS = [
  "Husband",
  "Wife",
  "Father",
  "Mother",
  "Son",
  "Daughter",
  "Brother",
  "Sister",
  "Elder Brother",
  "Elder Sister",
  "Son's Wife",
  "Daughter's Husband",
  "Guardian",
  "Relative",
  "Other",
];

export const CHILD_SERIAL_LABELS = ["ELDER", "SECOND", "THIRD", "YOUNGEST", "CUSTOM"];
export const SIBLING_SERIAL_LABELS = ["ELDER", "YOUNGER", "CUSTOM"];

const NOTE_TYPES = new Set(["Guardian", "Relative", "Other"]);
const LINK_TYPES = new Set(["Son's Wife", "Daughter's Husband"]);
const CHILD_TYPES = new Set(["Son", "Daughter"]);
const SIBLING_TYPES = new Set(["Brother", "Sister", "Elder Brother", "Elder Sister"]);

export function needsRelationshipNote(rel) {
  return NOTE_TYPES.has(String(rel || "").trim());
}

export function needsLinkedMember(rel) {
  return LINK_TYPES.has(String(rel || "").trim());
}

export function needsSerial(rel) {
  const value = String(rel || "").trim();
  return CHILD_TYPES.has(value) || SIBLING_TYPES.has(value);
}

export function serialLabelsFor(rel) {
  const value = String(rel || "").trim();
  if (CHILD_TYPES.has(value)) return CHILD_SERIAL_LABELS;
  if (SIBLING_TYPES.has(value)) return SIBLING_SERIAL_LABELS;
  return [];
}

export function buildJoinInvitePayload(form) {
  const body = {
    invite_code: String(form.invite_code || "").trim().toUpperCase(),
    relationship_type: form.relationship_type || "Other",
  };
  if (form.serial_label?.trim()) body.serial_label = form.serial_label.trim().toUpperCase();
  if (form.relationship_serial?.toString?.().trim?.()) {
    const n = Number(form.relationship_serial);
    if (Number.isFinite(n)) body.relationship_serial = n;
    else if (!body.serial_label) body.relationship_serial = String(form.relationship_serial).trim();
  }
  if (form.linked_member_id?.trim?.()) body.linked_member_id = form.linked_member_id.trim();
  if (form.relationship_note?.trim?.()) body.relationship_note = form.relationship_note.trim();
  return body;
}
