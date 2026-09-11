export function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="border-b border-line bg-panel/40">
      <div className="mx-auto max-w-[1220px] px-5 py-14 md:py-16">
        {eyebrow && (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-accent/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-accent">
            {eyebrow}
          </span>
        )}
        <h1 className="mt-4 text-3xl font-black tracking-tight text-text md:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-4 max-w-2xl text-lg text-muted">{subtitle}</p>
        )}
      </div>
    </section>
  );
}

export function Note({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "good";
  children: React.ReactNode;
}) {
  const styles =
    tone === "good"
      ? "border-good/60 bg-good/10 text-good"
      : "border-warn/60 bg-warn/10 text-warn";
  return (
    <div className={`rounded-xl border-s-4 px-5 py-4 text-sm ${styles}`}>
      {children}
    </div>
  );
}
