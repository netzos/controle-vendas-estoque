// Gráficos simples em SVG, desenhados no servidor. Uma série, uma cor (tinta),
// sem eixo duplo; o valor exato aparece ao passar o mouse e na tabela ao lado.

export function BarChart({
  data,
  height = 220,
  format,
  emptyText = "Sem dados no período.",
}: {
  data: { label: string; value: number; detail?: string }[];
  height?: number;
  format: (v: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (max === 0) return <p className="chart-empty">{emptyText}</p>;
  const w = 100 / data.length;
  const labelEvery = data.length > 16 ? Math.ceil(data.length / 8) : 1;
  const peak = data.reduce((a, d, i) => (d.value > data[a]!.value ? i : a), 0);
  return (
    <figure className="bar-chart" style={{ height }}>
      <div className="bar-plot" role="img" aria-label={`Maior valor: ${data[peak]!.label}, ${format(data[peak]!.value)}`}>
        <span className="bar-max">{format(max)}</span>
        {data.map((d, i) => (
          <div key={d.label} className="bar-slot" style={{ width: `${w}%` }}>
            <div className={`bar${i === peak ? " peak" : ""}`} style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 1.5 : 0)}%` }} />
            <span className="bar-tip">
              <strong>{d.label}</strong>
              {format(d.value)}
              {d.detail && <em>{d.detail}</em>}
            </span>
          </div>
        ))}
      </div>
      <div className="bar-labels">
        {data.map((d, i) => (
          <span key={d.label} style={{ width: `${w}%` }}>{i % labelEvery === 0 ? d.label : ""}</span>
        ))}
      </div>
    </figure>
  );
}

export function RankList({
  rows,
  emptyText,
}: {
  rows: { key: string; label: string; value: string; sub?: string; ratio: number }[];
  emptyText: string;
}) {
  if (rows.length === 0) return <p className="chart-empty">{emptyText}</p>;
  return (
    <ol className="rank">
      {rows.map((r, i) => (
        <li key={r.key}>
          <span className="rank-pos">{i + 1}</span>
          <div className="rank-body">
            <div className="rank-line">
              <span className="rank-label">{r.label}</span>
              <strong>{r.value}</strong>
            </div>
            <div className="rank-track"><div style={{ width: `${Math.max(r.ratio * 100, 2)}%` }} /></div>
            {r.sub && <span className="rank-sub">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Kpi({
  label,
  value,
  current,
  previous,
  sub,
  tone,
  hero,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  sub?: string;
  tone?: "bad" | "warn";
  hero?: boolean;
}) {
  let delta: React.ReactNode = null;
  if (current !== undefined && previous !== undefined) {
    if (previous === 0) {
      // Sem período anterior não há com o que comparar.
      delta = null;
    } else {
      const pct = ((current - previous) / previous) * 100;
      const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
      delta = (
        <span className={`delta ${dir}`} title="Comparado ao período anterior">
          {dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {Math.abs(pct).toFixed(0)}%
        </span>
      );
    }
  }
  return (
    <div className={`kpi${hero ? " hero" : ""}${tone ? ` ${tone}` : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-foot">
        {delta}
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}
