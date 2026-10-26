import Link from "next/link";
import { can, costsOverview, listCosts, listCostTypes, listProducts, listSuppliers, orgDate, type CostPeriod } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money } from "@/lib/format";
import { Kpi, RankList } from "@/components/charts";
import { CancelCostButton, CostForm } from "./forms";

export const metadata = { title: "Painel de custos" };

const PERIODS: { key: CostPeriod; label: string; previous: string }[] = [
  { key: "7d", label: "7 dias", previous: "7 dias anteriores" },
  { key: "30d", label: "30 dias", previous: "30 dias anteriores" },
  { key: "month", label: "Este mês", previous: "mês passado" },
  { key: "last_month", label: "Mês passado", previous: "mês retrasado" },
  { key: "90d", label: "90 dias", previous: "90 dias anteriores" },
];

const dateLabel = (d: string) => d.split("-").reverse().join("/");

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ periodo?: string; tipo?: string; novo?: string }> }) {
  const actor = await requirePermission("costs.view");
  const params = await searchParams;
  const period = PERIODS.find((p) => p.key === params.periodo) ?? PERIODS[2]!;
  const canManage = can(actor, "costs.manage");
  const [o, costs, types, today] = await Promise.all([
    query(costsOverview, { period: period.key }),
    query(listCosts, { period: period.key, costTypeId: params.tipo || undefined }),
    query(listCostTypes, {}),
    query(orgDate, {}),
  ]);
  const [products, suppliers] = canManage
    ? await Promise.all([
        can(actor, "products.view") ? query(listProducts, { limit: 500 }) : Promise.resolve([]),
        can(actor, "suppliers.view") ? query(listSuppliers, { limit: 500 }) : Promise.resolve([]),
      ])
    : [[], []];
  const href = (p: string, tipo?: string) => `/custos?periodo=${p}${tipo ? `&tipo=${tipo}` : ""}`;
  const productCostShare = Number(o.revenue) > 0 ? (Number(o.productCost) / Number(o.revenue)) * 100 : 0;
  const costsShare = Number(o.revenue) > 0 ? (Number(o.costs) / Number(o.revenue)) * 100 : 0;
  const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}% do faturamento`;

  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Lucro real</h1>
          <p>
            Os gastos da empresa (luz, aluguel, frete, salários) e o lucro que sobra de verdade depois deles.
            O custo de cada produto fica em <Link href="/custos/obtencao">Custo de cada produto</Link>.
          </p>
        </div>
        <div className="dash-actions">
          <nav className="segmented" aria-label="Período">
            {PERIODS.map((p) => (
              <Link key={p.key} href={href(p.key, params.tipo)} className={p.key === period.key ? "active" : ""}>{p.label}</Link>
            ))}
          </nav>
          {canManage && <Link className="button" href={`${href(period.key)}&novo=1`}>+ Lançar custo</Link>}
        </div>
      </div>

      {canManage && params.novo === "1" && (
        <section className="card">
          <h2>Novo custo</h2>
          <CostForm
            today={today}
            types={types.map((t) => ({ id: t.id, name: t.name }))}
            products={products.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))}
            suppliers={suppliers.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }))}
          />
        </section>
      )}

      <div className="kpi-grid">
        <Kpi
          hero
          label="Lucro real"
          value={money(o.realProfit)}
          current={Number(o.realProfit)}
          previous={Number(o.previous.realProfit)}
          sub={o.realMargin ? `margem ${o.realMargin.replace(".", ",")}% · vs. ${period.previous}` : `vs. ${period.previous}`}
        />
        <Kpi label="Faturamento" value={money(o.revenue)} sub={`lucro bruto ${money(o.grossProfit)}`} />
        <Kpi label="Custo dos produtos" value={money(o.productCost)} sub={pct(productCostShare)} />
        <Kpi label="Outros custos" value={money(o.costs)} sub={`${pct(costsShare)} · antes ${money(o.previous.costs)}`} tone={costsShare > 30 ? "warn" : undefined} />
      </div>

      <div className="dash-grid">
        <section className="card">
          <div className="card-head"><h2>Para onde vai o dinheiro</h2><span className="muted">{money(o.costs)}</span></div>
          <RankList
            emptyText="Nenhum custo lançado no período."
            rows={o.byType.map((t) => ({
              key: t.costTypeId,
              label: t.name,
              value: money(t.amount),
              ratio: t.share,
              sub: `${(t.share * 100).toFixed(0)}% dos custos · ${t.count} ${t.count === 1 ? "lançamento" : "lançamentos"}`,
            }))}
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Custos por produto</h2></div>
          <RankList
            emptyText="Nenhum custo ligado a produto no período."
            rows={o.byProduct.map((p) => ({ key: p.productId, label: p.name, value: money(p.amount), ratio: Number(p.amount) / Number(o.byProduct[0]!.amount) }))}
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Como fica cada R$ 100 vendidos</h2></div>
          {Number(o.revenue) > 0 ? (
            <ul className="mini-list">
              <li><span>Custo dos produtos</span><strong>{money(productCostShare)}</strong></li>
              <li><span>Outros custos</span><strong>{money(costsShare)}</strong></li>
              <li><span>Sobra (lucro real)</span><strong>{money(100 - productCostShare - costsShare)}</strong></li>
            </ul>
          ) : (
            <p className="chart-empty">Sem vendas no período.</p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <nav className="segmented" aria-label="Tipo">
            <Link href={href(period.key)} className={!params.tipo ? "active" : ""}>Todos</Link>
            {o.byType.map((t) => (
              <Link key={t.costTypeId} href={href(period.key, t.costTypeId)} className={params.tipo === t.costTypeId ? "active" : ""}>{t.name}</Link>
            ))}
          </nav>
          <span className="muted">{costs.length} lançamentos</span>
        </div>
        {costs.length === 0 ? (
          <p className="chart-empty">Nenhum custo lançado{params.tipo ? " deste tipo" : ""} no período.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Custo</th><th>Grupo</th><th>Ligado a</th><th className="num">Valor</th><th>Por</th>{canManage && <th />}</tr></thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id}>
                    <td>{dateLabel(c.incurredOn)}</td>
                    <td>{c.description || c.costTypeName}</td>
                    <td className="muted">{c.costTypeName}</td>
                    <td>
                      {[
                        c.saleNumber ? <Link key="s" href={`/vendas?id=${c.saleId}`}>Venda nº {c.saleNumber}</Link> : null,
                        c.productName ? <span key="p">{c.productName}</span> : null,
                        c.supplierName ? <span key="f">{c.supplierName}</span> : null,
                      ].filter(Boolean).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, " · ", n] : [n]), [])}
                    </td>
                    <td className="num"><strong>{money(c.amount)}</strong></td>
                    <td>{c.userName}</td>
                    {canManage && <td><div className="row-actions">{!c.stepId && <CancelCostButton id={c.id} />}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
