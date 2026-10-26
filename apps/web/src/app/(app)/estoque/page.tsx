import Link from "next/link";
import { can, getOrganization, MOVEMENT_LABELS, stockDashboard, stockOverview, type MovementKind, type StockStatus } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { BarChart, Kpi, RankList } from "@/components/charts";
import { AutoRefresh } from "@/components/auto-refresh";

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
  const [{ kpis, rows }, dash, org] = await Promise.all([query(stockOverview, {}), query(stockDashboard, {}), query(getOrganization, {})]);
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  // Acaba logo: ainda tem saldo, mas no ritmo dos últimos 30 dias não passa de uma semana.
  const endingSoon = rows.filter((r) => Number(r.stockQty) > 0 && r.coverageDays != null && r.coverageDays <= 7).sort((a, b) => a.coverageDays! - b.coverageDays!).slice(0, 6);
  const abcTotal = dash.abc.reduce((a, c) => a + Number(c.revenue), 0);
  const maxCategory = Math.max(...dash.byCategory.map((c) => Number(c.value)), 0);
  const filter = FILTERS.find((f) => f.key === (params.filtro ?? "")) ?? FILTERS[0]!;
  const shown = rows.filter((r) => filter.match(r.status));
  const maxValue = Math.max(...rows.map((r) => Number(r.costValue)), 0);

  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Estoque</h1>
          <p>Quanto tem de cada produto e por quantos dias ainda dá, no ritmo de vendas dos últimos 30 dias. <AutoRefresh /></p>
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
        <Kpi label="Vendido em 30 dias" value={kpis.turnover30 ? `${Math.round(Number(kpis.turnover30) * 100)}%` : "—"} sub="do valor que está no estoque" />
        <Kpi label="O estoque dura" value={days(kpis.avgCoverageDays)} sub="em média, no ritmo atual" />
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

      <div className="dash-grid spaced">
        <section className="card span-2">
          <div className="card-head">
            <h2>Saídas por dia (30 dias)</h2>
            <span className="muted">entrou {money(dash.flowTotals.inValue)} · saiu {money(dash.flowTotals.outValue)}</span>
          </div>
          <BarChart
            data={dash.flow.map((d) => ({ label: d.label, value: Number(d.outValue), detail: Number(d.inValue) > 0 ? `entrou ${money(d.inValue)}` : undefined }))}
            format={money}
            emptyText="Nenhuma saída nos últimos 30 dias."
          />
          <p className="muted small-text">Valor a preço de custo do que saiu (vendas e saídas manuais). Passe o dedo ou o mouse para ver o que entrou no dia.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Acaba em até 7 dias</h2></div>
          <RankList
            emptyText="Nenhum produto acabando nesta semana."
            rows={endingSoon.map((r) => ({
              key: r.id,
              label: r.name,
              value: days(r.coverageDays),
              sub: `${quantity(r.stockQty)} ${r.unitCode} · vende ${quantity(r.avgDaily)}/dia`,
              ratio: 1 - r.coverageDays! / 7,
            }))}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Dinheiro parado por categoria</h2></div>
          <RankList
            emptyText="Nada em estoque ainda."
            rows={dash.byCategory.map((c) => ({
              key: c.name,
              label: c.name,
              value: money(c.value),
              sub: `${c.products} ${c.products === 1 ? "produto" : "produtos"}`,
              ratio: maxCategory ? Number(c.value) / maxCategory : 0,
            }))}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Curva ABC (30 dias)</h2></div>
          {abcTotal === 0 ? (
            <p className="chart-empty">Sem vendas nos últimos 30 dias.</p>
          ) : (
            <ul className="abc">
              {dash.abc.map((c) => (
                <li key={c.cls}>
                  <span className={`abc-cls ${c.cls}`}>{c.cls}</span>
                  <div>
                    <strong>{c.products} {c.products === 1 ? "produto" : "produtos"}</strong>
                    <span className="muted">{Math.round((Number(c.revenue) / abcTotal) * 100)}% do faturamento · {money(c.revenue)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small-text">A são os que mais vendem: nunca deixe faltar. C vendem pouco: compre com cuidado.</p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Últimas movimentações</h2>
            <Link href="/estoque/movimentacoes" className="muted">Ver todas</Link>
          </div>
          {dash.recent.length === 0 ? (
            <p className="chart-empty">Nenhuma movimentação ainda.</p>
          ) : (
            <ul className="feed">
              {dash.recent.map((m) => (
                <li key={m.id}>
                  <span className={`feed-qty ${Number(m.quantity) > 0 ? "in" : "out"}`}>{Number(m.quantity) > 0 ? "+" : "−"}{quantity(String(Math.abs(Number(m.quantity))))} {m.unitCode}</span>
                  <div>
                    <strong>{m.productName}</strong>
                    <span className="muted">{MOVEMENT_LABELS[m.kind as MovementKind] ?? m.kind} · {timeFmt.format(m.createdAt)} · {m.userName.split(" ")[0]}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
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
            <table className="cards">
              <thead>
                <tr>
                  <th>Produto</th><th className="num">Saldo</th><th>Saldo × mínimo</th><th className="num">Vendido 30d</th>
                  <th className="num">Média/dia</th><th className="num">Dura</th><th className="num">Valor (custo)</th><th>Situação</th>
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
                      <td data-label="Saldo" className="num"><strong>{quantity(r.stockQty)}</strong> {r.unitCode}</td>
                      <td data-label="Saldo × mínimo" className="sm-hide">
                        <div className="meter" title={`Saldo ${quantity(r.stockQty)} · mínimo ${quantity(r.minStock)}`}>
                          <div className={`meter-fill ${r.status}`} style={{ width: `${(Math.max(stock, 0) / scale) * 100}%` }} />
                          {min > 0 && <div className="meter-min" style={{ left: `${(min / scale) * 100}%` }} />}
                        </div>
                      </td>
                      <td data-label="Vendido 30d" className="num sm-hide">{quantity(r.soldQty30)}</td>
                      <td data-label="Média/dia" className="num sm-hide">{quantity(r.avgDaily)}</td>
                      <td data-label="Dura" className="num">{days(r.coverageDays)}</td>
                      <td data-label="Valor (custo)" className="num">
                        {money(r.costValue)}
                        <div className="value-bar"><div style={{ width: `${maxValue ? (Number(r.costValue) / maxValue) * 100 : 0}%` }} /></div>
                      </td>
                      <td data-label="Situação">
                        {/* Saldo negativo = vendido por encomenda: falta pedir ao fornecedor. */}
                        <span className={`tag ${STATUS[r.status].tag}`}>{stock < 0 ? `Encomendado · faltam ${quantity(String(-stock))}` : STATUS[r.status].label}</span>
                      </td>
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
