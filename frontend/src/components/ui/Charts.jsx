/** Pure SVG Pie / Bar / Line charts — architecture Reports requirement (no extra deps). */

function moneyLabel(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

export function PieChart({ data = [], size = 180, colors }) {
  const palette = colors || ["#0F766E", "#2563EB", "#DC2626", "#D97706", "#7C3AED", "#DB2777", "#64748B"];
  const total = data.reduce((s, d) => s + Math.max(0, Number(d.value || 0)), 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const value = Math.max(0, Number(d.value || 0));
    const sweep = (value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const path =
      value <= 0
        ? ""
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { ...d, path, color: palette[i % palette.length], pct: ((value / total) * 100).toFixed(1) };
  });

  return (
    <div className="s4-chart s4-chart-pie">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Pie chart">
        {slices.map((s, i) =>
          s.path ? <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="1" /> : null
        )}
      </svg>
      <ul className="s4-chart-legend">
        {slices.map((s, i) => (
          <li key={i}>
            <span className="s4-chart-swatch" style={{ background: s.color }} />
            {s.label}: {moneyLabel(s.value)} ({s.pct}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart({ data = [], height = 160, colors }) {
  const palette = colors || ["#0F766E", "#2563EB", "#DC2626", "#D97706"];
  const max = Math.max(...data.map((d) => Number(d.value || 0)), 1);
  const w = Math.max(240, data.length * 48);

  return (
    <div className="s4-chart s4-chart-bar">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Bar chart">
        {data.map((d, i) => {
          const v = Math.max(0, Number(d.value || 0));
          const barH = (v / max) * (height - 36);
          const x = 16 + i * 48;
          const y = height - 24 - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={28} height={barH} rx={4} fill={palette[i % palette.length]} />
              <text x={x + 14} y={height - 8} textAnchor="middle" fontSize="10" fill="#475569">
                {(d.label || "").slice(0, 6)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({ data = [], width = 320, height = 160, color = "#2563EB" }) {
  const values = data.map((d) => Number(d.value || 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pad = 16;
  const pts = values.map((v, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(values.length - 1, 1);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const circles = values.map((v, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(values.length - 1, 1);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return { x, y, label: data[i]?.label };
  });

  return (
    <div className="s4-chart s4-chart-line">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        <polyline fill="none" stroke={color} strokeWidth="2.5" points={pts.join(" ")} />
        {circles.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3.5" fill={color} />
        ))}
      </svg>
    </div>
  );
}
