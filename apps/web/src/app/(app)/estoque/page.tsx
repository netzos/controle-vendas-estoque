import Link from "next/link";
import { can, stockOverview, type StockStatus } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { Kpi } from "@/components/charts";

export const metadata = { title: "Painel do estoque" };

const STATUS: Record<StockStatus, { label: string; tag: string }> = {
  out: { label: "Zerado", tag: "off" },
  low: { label: "Abaixo do mínimo", tag: "warn" },
  idle: { label: "Parado", tag: "" },
  ok: { label: "OK", tag: "ok" },
};

const FILTERS: { key: string; label: string; match: (s: StockStatus) => boolean }[] = [
  { key: "", label: "Todos", match: () => true },
  { key: "zerados", label: "Zerados", match: (s) => s === "out" },
  { key: "baixo", label: "Abaixo do mínimo", match: (s) => s === "low" },
  { key: "parados", label: "Parados", match: (s) => s === "idle" },
];

const days = (n: number | null) => (n == null ? "—" : n >= 365 ? "+1 ano" : `${Math.round(n)} ${Math.round(n) === 1 ? "dia" : "dias"}`);

export default async function StockPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const actor = await requirePermission("stock.view");
  const params = await searchParams;
  const { kpis, rows } = await query(stockOverview, {});
  const filter = FILTERS.find((f) => f.key === (params.filtro ?? "")) ?? FILTERS[0]!;
  const shown = rows.filter((r) => filter.match(r.status));
  const maxValue = Math.max(...rows.map((r) => Number(r.costValue)), 0);

  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Estoque</h1>
          <p>Saldo, giro e quantos dias cada produto ainda aguenta no ritmo de vendas dos últimos 30 dias.</p>
        </div>
        {can(actor, "stock.manage") && (
          <div className="dash-actions">
            <Link className="button" href="/estoque/movimentacoes?novo=in">+ Entrada</Link>
            <Link className="button secondary" href="/estoque/movimentacoes?novo=adjust">Ajustar saldo</Link>
          </div>
        )}
      </div>

      <div className="kpi-grid">
        <Kpi hero label="Valor em estoque (custo)" value={money(kpis.costValue)} sub={`${kpis.products} produtos`} />
        <Kpi label="Valor de venda" value={money(kpis.saleValue)} sub={`lucro potencial ${money(kpis.potentialProfit)}`} />
        <Kpi label="Giro em 30 dias" value={kpis.turnover30 ? `${kpis.turnover30.replace(".", ",")}x` : "—"} sub="custo vendido ÷ estoque" />
        <Kpi label="Cobertura média" value={days(kpis.avgCoverageDays)} sub="até acabar, no ritmo atual" />
      </div>

      <div className="kpi-grid compact">
        <Link href="/estoque?filtro=zerados" className={`kpi link${kpis.outCount ? " bad" : ""}`}>
          <span className="kpi-label">Zerados</span><span className="kpi-value">{kpis.outCount}</span><span className="kpi-foot">sem saldo para vender</span>
        </Link>
        <Link href="/estoque?filtro=baixo" className={`kpi link${kpis.lowCount ? " warn" : ""}`}>
          <span className="kpi-label">Abaixo do mínimo</span><span className="kpi-value">{kpis.lowCount}</span><span className="kpi-foot">hora de repor</span>
        </Link>
        <Link href="/estoque?filtro=parados" className="kpi link">
          <span className="kpi-label">Parados</span><span className="kpi-value">{kpis.idleCount}</span><span className="kpi-foot">sem venda em 30 dias</span>
        </Link>
      </div>

      <section className="card">
        <div className="card-head">
          <nav className="segmented" aria-label="Filtro">
            {FILTERS.map((f) => (
              <Link key={f.key} href={f.key ? `/estoque?filtro=${f.key}` : "/estoque"} className={f === filter ? "active" : ""}>{f.label}</Link>
            ))}
          </nav>
          <span className="muted">{shown.length} de {rows.length}</span>
        </div>
        {shown.length === 0 ? (
          <p className="chart-empty">{rows.length === 0 ? "Nenhum produto com controle de estoque ainda." : "Nenhum produto neste filtro."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th><th className="num">Saldo</th><th>Saldo × mínimo</th><th className="num">Vendido 30d</th>
                  <th className="num">Média/dia</th><th className="num">Cobertura</th><th className="num">Valor (custo)</th><th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const stock = Number(r.stockQty);
                  const min = Number(r.minStock);
                  const scale = Math.max(stock, min * 2, 1);
                  return (
                    <tr key={r.id} className="clickable">
                      <td>
                        <Link href={`/estoque/movimentacoes?produto=${r.id}`}>{r.name}</Link>
                        <small className="muted">{r.sku}{r.categoryName ? ` · ${r.categoryName}` : ""}</small>
                      </td>
                      <td className="num"><strong>{quantity(r.stockQty)}</strong> {r.unitCode}</td>
                      <td>
                        <div className="meter" title={`Saldo ${quantity(r.stockQty)} · mínimo ${quantity(r.minStock)}`}>
                          <div className={`meter-fill ${r.status}`} style={{ width: `${(Math.max(stock, 0) / scale) * 100}%` }} />
                          {min > 0 && <div className="meter-min" style={{ left: `${(min / scale) * 100}%` }} />}
                        </div>
                      </td>
                      <td className="num">{quantity(r.soldQty30)}</td>
                      <td className="num">{quantity(r.avgDaily)}</td>
                      <td className="num">{days(r.coverageDays)}</td>
                      <td className="num">
                        {money(r.costValue)}
                        <div className="value-bar"><div style={{ width: `${maxValue ? (Number(r.costValue) / maxValue) * 100 : 0}%` }} /></div>
                      </td>
                      <td><span className={`tag ${STATUS[r.status].tag}`}>{STATUS[r.status].label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
