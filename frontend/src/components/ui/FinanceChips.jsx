export function typeTone(type) {
  const value = String(type || "").toUpperCase();
  if (
    value.includes("INCOME") ||
    value.includes("DEPOSIT") ||
    value === "GIVEN" ||
    value.includes("CREDIT")
  ) {
    return "income";
  }
  if (
    value.includes("EXPENSE") ||
    value.includes("WITHDRAW") ||
    value === "TAKEN" ||
    value.includes("DEBIT") ||
    value.includes("OVER")
  ) {
    return "expense";
  }
  if (value.includes("TRANSFER")) return "transfer";
  if (value.includes("LOAN")) return "loan";
  if (value.includes("SAVINGS") || value.includes("BUDGET") || value.includes("GOAL")) {
    return "savings";
  }
  if (value.includes("PENDING") || value.includes("WARN") || value.includes("LOW")) {
    return "warn";
  }
  return "neutral";
}

export function TypeChip({ type, children, className = "" }) {
  const label = children || type || "—";
  const tone = typeTone(type || label);
  return <span className={`type-chip type-${tone} ${className}`.trim()}>{label}</span>;
}

export function MoneyPill({ children, tone = "", signed = "" }) {
  const signClass = signed === "+" ? "is-plus" : signed === "-" ? "is-minus" : "";
  const toneClass = tone ? `tone-${tone}` : "";
  return (
    <span className={`money-pill ${toneClass} ${signClass}`.trim()}>
      {signed}
      {children}
    </span>
  );
}
