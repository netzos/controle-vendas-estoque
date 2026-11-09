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

// Linha do período (tinta) com o período anterior tracejado (cinza). O SVG estica
// para a largura do cartão (traço sem distorcer); os textos ficam em HTML.
export function LineChart({
  points,
  previous,
  second,
  format,
  height = 220,
  labels,
  emptyText = "Sem dados no período.",
}: {
  points: { label: string; value: number; detail?: string }[];
  previous?: number[];
  second?: { name: string; values: number[] };
  format: (v: number) => string;
  height?: number;
  labels: { current: string; previous?: string };
  emptyText?: string;
}) {
  const all = [...points.map((p) => p.value), ...(previous ?? []), ...(second?.values ?? [])];
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  if (max === 0 && min === 0) return <p className="chart-empty">{emptyText}</p>;
  const n = points.length;
  // Coordenadas 0..1000 × 0..100; cada ponto no meio da sua fatia.
  const x = (i: number) => ((i + 0.5) * 1000) / n;
  const y = (v: number) => 100 - ((v - min) / (max - min || 1)) * 100;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(2)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const peak = points.reduce((a, p, i) => (p.value > points[a]!.value ? i : a), 0);
  return (
    <figure className="line-chart">
      <div className="line-legend">
        <span><i className="sw ink" /> {labels.current}</span>
        {second && <span><i className="sw mid" /> {second.name}</span>}
        {previous && labels.previous && <span><i className="sw dash" /> {labels.previous}</span>}
      </div>
      <div className="line-plot" style={{ height }}>
        <span className="bar-max">{format(max)}</span>
        <svg viewBox="0 -2 1000 104" preserveAspectRatio="none" role="img" aria-label={`Maior valor: ${points[peak]!.label}, ${format(points[peak]!.value)}`}>
          {min < 0 && <line x1="0" x2="1000" y1={y(0)} y2={y(0)} className="axis" />}
          {previous && previous.length > 0 && <path d={path(previous)} className="prev" />}
          {second && <path d={path(second.values)} className="second" />}
          <path d={path(points.map((p) => p.value))} className="cur" />
        </svg>
        <div className="line-hits">
          {points.map((p, i) => (
            <span key={`${p.label}-${i}`} className="bar-slot" style={{ width: `${100 / n}%` }}>
              <span className="bar-tip">
                <strong>{p.label}</strong>
                {format(p.value)}
                {second && <em>{second.name}: {format(second.values[i] ?? 0)}</em>}
                {previous?.[i] !== undefined && <em>Antes: {format(previous[i]!)}</em>}
                {p.detail && <em>{p.detail}</em>}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="bar-labels">
        {points.map((p, i) => (
          <span key={`${p.label}-${i}`} style={{ width: `${100 / n}%` }}>{i % labelEvery === 0 ? p.label : ""}</span>
        ))}
      </div>
    </figure>
  );
}

// Uma barra por dia (ou hora/semana/mês): faturamento em tinta e lucro em cinza,
// lado a lado. O período anterior aparece como um risco tracejado na altura do
// faturamento de antes. Lucro negativo não desenha barra, mas aparece na dica.
export function GroupedBarChart({
  points,
  second,
  previous,
  format,
  height = 220,
  labels,
  emptyText = "Sem dados no período.",
}: {
  points: { label: string; value: number; detail?: string }[];
  second?: { name: string; values: number[] };
  previous?: number[];
  format: (v: number) => string;
  height?: number;
  labels: { current: string; previous?: string };
  emptyText?: string;
}) {
  const max = Math.max(...points.map((p) => p.value), ...(second?.values ?? []), ...(previous ?? []), 0);
  if (max === 0) return <p className="chart-empty">{emptyText}</p>;
  const n = points.length;
  const w = 100 / n;
  const h = (v: number) => (v > 0 ? `${Math.max((v / max) * 100, 1.5)}%` : "0%");
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const peak = points.reduce((a, p, i) => (p.value > points[a]!.value ? i : a), 0);
  const hasPrev = !!previous && previous.some((v) => v > 0);
  return (
    <figure className="bar-chart group-chart" style={{ height: height + 60 }}>
      <div className="line-legend">
        <span><i className="sq ink" /> {labels.current}</span>
        {second && <span><i className="sq mid" /> {second.name}</span>}
        {hasPrev && labels.previous && <span><i className="sw dash" /> {labels.previous}</span>}
      </div>
      <div className="bar-plot" role="img" aria-label={`Maior valor: ${points[peak]!.label}, ${format(points[peak]!.value)}`}>
        <span className="bar-max">{format(max)}</span>
        {points.map((p, i) => {
          const prev = previous?.[i];
          return (
            <div key={`${p.label}-${i}`} className={`bar-slot${n > 20 ? " dense" : ""}`} style={{ width: `${w}%` }}>
              <div className="bar-pair">
                <div className="gbar cur" style={{ height: h(p.value) }} />
                {second && <div className="gbar second" style={{ height: h(second.values[i] ?? 0) }} />}
              </div>
              {hasPrev && prev !== undefined && prev > 0 && <span className="prev-mark" style={{ bottom: `${(prev / max) * 100}%` }} />}
              <span className="bar-tip">
                <strong>{p.label}</strong>
                {format(p.value)}
                {second && <em>{second.name}: {format(second.values[i] ?? 0)}</em>}
                {prev !== undefined && <em>Antes: {format(prev)}</em>}
                {p.detail && <em>{p.detail}</em>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="bar-labels">
        {points.map((p, i) => (
          <span key={`${p.label}-${i}`} style={{ width: `${w}%` }}>{i % labelEvery === 0 ? p.label : ""}</span>
        ))}
      </div>
    </figure>
  );
}

// Quadro dia da semana × hora: quanto mais escuro, mais vendeu.
export function Heatmap({
  cells,
  rows,
  format,
  emptyText = "Sem vendas no período.",
}: {
  cells: { row: number; col: number; value: number; count: number }[];
  rows: string[];
  format: (v: number) => string;
  emptyText?: string;
}) {
  if (cells.length === 0) return <p className="chart-empty">{emptyText}</p>;
  const max = Math.max(...cells.map((c) => c.value));
  const first = Math.min(...cells.map((c) => c.col));
  const last = Math.max(...cells.map((c) => c.col));
  const cols = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const at = new Map(cells.map((c) => [`${c.row}-${c.col}`, c]));
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th />
            {cols.map((h) => <th key={h} scope="col">{h}h</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((name, r) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              {cols.map((h) => {
                const c = at.get(`${r}-${h}`);
                const level = c ? Math.max(0.08, c.value / max) : 0;
                return (
                  <td key={h} style={{ background: c ? `rgba(15, 17, 21, ${level.toFixed(2)})` : undefined }} title={c ? `${name}, ${h}h: ${format(c.value)} em ${c.count} ${c.count === 1 ? "venda" : "vendas"}` : `${name}, ${h}h: sem vendas`} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heatmap-scale"><span>menos</span><i /><span>mais</span></div>
    </div>
  );
}

// Barra única dividida em partes (curva ABC, novos x que voltaram).
export function SplitBar({ parts }: { parts: { label: string; value: number; sub?: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="chart-empty">Sem dados no período.</p>;
  return (
    <div className="split">
      <div className="split-bar">
        {parts.map((p, i) => p.value > 0 && <span key={p.label} className={`split-${i}`} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${Math.round((p.value / total) * 100)}%`} />)}
      </div>
      <ul className="split-legend">
        {parts.map((p, i) => (
          <li key={p.label}>
            <i className={`split-${i}`} />
            <span><strong>{p.label}</strong> {Math.round((p.value / total) * 100)}%{p.sub ? <em> · {p.sub}</em> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
