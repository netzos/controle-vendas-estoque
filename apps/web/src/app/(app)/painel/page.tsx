import Link from "next/link";
import { can, dashboardOverview, enabledFeatures } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { money, quantity } from "@/lib/format";
import { GroupedBarChart, Kpi } from "@/components/charts";
import { PanelHeader, panelLink, parseFilters, previousLabel, WEEKDAYS_SHORT, type PanelParams } from "./filters";

const GROUPS = [
  { key: "dia", step: "day", label: "Dia" },
  { key: "semana", step: "week", label: "Semana" },
  { key: "mes", step: "month", label: "Mês" },
] as const;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const metadata = { title: "Painel" };

export default async function PanelOverview({ searchParams }: { searchParams: Promise<PanelParams> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const filters = parseFilters(params);
  const [o, features] = await Promise.all([query(dashboardOverview, filters), enabledFeatures(db(), actor.organizationId)]);
  const canCosts = features.has("costs") && can(actor, "costs.view");
  const c = o.current;
  const p = o.previous;
  const n = (v: string) => Number(v);
  // Outros custos são da empresa toda: com filial ou vendedor escolhido, fica só o lucro bruto.
  const showReal = canCosts && !filters.branchId && !filters.sellerId;
  const link = (path: string) => panelLink(path, params);

  return (
    <>
      <PanelHeader actor={actor} path="/painel" params={params} filters={filters} range={o.range} sellers={o.sellers} />

      <div className="kpi-grid">
        <Kpi hero label="Faturamento" value={money(c.revenue)} current={n(c.revenue)} previous={n(p.revenue)} sub={`antes ${money(p.revenue)}`} />
        <Kpi label="Vendas" value={String(c.count)} current={c.count} previous={p.count} sub={`${quantity(c.items)} itens`} />
        <Kpi label="Ticket médio" value={money(c.ticket)} current={n(c.ticket)} previous={n(p.ticket)} />
        {showReal ? (
          <Kpi label="Lucro real" value={money(c.realProfit)} current={n(c.realProfit)} previous={n(p.realProfit)} sub={`bruto ${money(c.profit)} · custos ${money(c.otherCosts)}`} />
        ) : (
          <Kpi label="Lucro bruto" value={money(c.profit)} current={n(c.profit)} previous={n(p.profit)} sub={c.margin ? `margem ${c.margin.replace(".", ",")}%` : undefined} />
        )}
      </div>

      <div className="kpi-grid compact four">
        <Kpi label="Recebido" value={money(c.received)} current={n(c.received)} previous={n(p.received)} sub="pagamentos lançados no período" />
        <Link href="/vendas?receber=1" className="kpi link">
          <span className="kpi-label">Falta receber</span>
          <span className="kpi-value">{money(o.receivable.amount)}</span>
          <span className="kpi-foot"><span>{o.receivable.count} {o.receivable.count === 1 ? "venda" : "vendas"}, de qualquer data →</span></span>
        </Link>
        <Kpi label="Clientes que compraram" value={String(c.customers)} current={c.customers} previous={p.customers} />
        <Kpi label="Descontos dados" value={money(c.discount)} current={n(c.discount)} previous={n(p.discount)} />
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Faturamento e lucro {o.step === "hour" ? "por hora" : o.step === "day" ? "por dia" : o.step === "week" ? "por semana" : "por mês"}</h2>
            <span className="muted">{money(c.revenue)} no período</span>
          </div>
          <nav className="segmented" aria-label="Agrupar por">
            {GROUPS.map((g) => (
              <Link key={g.key} href={panelLink("/painel", params, { agrupar: g.key })} className={o.step === g.step ? "active" : ""} scroll={false}>{g.label}</Link>
            ))}
          </nav>
        </div>
        <GroupedBarChart
          points={o.series.map((s) => ({
            label: o.step === "month" ? `${MONTHS[Number(s.key.slice(5, 7)) - 1]}/${s.key.slice(2, 4)}` : s.label,
            sub: o.step === "day" ? WEEKDAYS_SHORT[new Date(`${s.key}T12:00:00Z`).getUTCDay()] : undefined,
            value: n(s.revenue),
            detail: `${s.count} ${s.count === 1 ? "venda" : "vendas"}`,
          }))}
          second={{ name: "Lucro bruto", values: o.series.map((s) => n(s.profit)) }}
          previous={o.previousSeries.map((s) => n(s.revenue))}
          labels={{ current: "Faturamento", previous: `Faturamento de ${previousLabel(o.range)}` }}
          format={money}
          emptyText="Nenhuma venda neste período."
        />
      </section>

      <div className="dash-grid">
        <Link href={link("/painel/vendas")} className="card summary-card">
          <h2>Vendas →</h2>
          <p className="muted">Melhores dias e horários, por filial, por vendedor, descontos e cancelamentos.</p>
        </Link>
        <Link href={link("/painel/produtos")} className="card summary-card">
          <h2>Produtos →</h2>
          <p className="muted">Mais vendidos, mais lucrativos, curva ABC e produtos parados no estoque.</p>
        </Link>
        <Link href={link("/painel/clientes")} className="card summary-card">
          <h2>Clientes →</h2>
          <p className="muted">Novos e que voltaram, melhores clientes e quem sumiu, com WhatsApp.</p>
        </Link>
      </div>
    </>
  );
}
