import Link from "next/link";
import { can, dashboardOverview, enabledFeatures } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { money, quantity } from "@/lib/format";
import { GroupedBarChart, Kpi } from "@/components/charts";
import { PanelHeader, panelLink, parseFilters, WEEKDAYS_SHORT, type PanelParams } from "./filters";

const GROUPS = [
  { key: "dia", step: "day", label: "Dia" },
  { key: "semana", step: "week", label: "Semana" },
  { key: "mes", step: "month", label: "Mês" },
] as const;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const UNIT = {
  hour: { per: "por hora", each: "por hora" },
  day: { per: "por dia", each: "por dia" },
  week: { per: "por semana", each: "por semana" },
  month: { per: "por mês", each: "por mês" },
} as const;

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

// Rótulo de cada barra. Semana e mês mostram só os dias que caem dentro do período
// (a primeira e a última podem ser pedaços), para não parecer que faltou venda.
function bucket(key: string, step: string, from: string, to: string): { label: string; sub?: string; title: string; partial?: boolean } {
  if (step === "hour") return { label: `${key}h`, title: `${key}h` };
  if (step === "day") {
    const wd = WEEKDAYS_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()]!;
    return { label: ddmm(key), sub: wd, title: `${wd}, ${ddmm(key)}` };
  }
  const monthEnd = () => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const end = step === "week" ? addDays(key, 6) : monthEnd();
  const a = key < from ? from : key;
  const z = end > to ? to : end;
  const partial = a !== key || z !== end;
  if (step === "week") return { label: ddmm(a), sub: a === z ? "1 dia" : `a ${ddmm(z)}`, title: `Semana de ${ddmm(a)} a ${ddmm(z)}`, partial };
  const m = `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
  return { label: m, sub: partial ? `${a.slice(8, 10)} a ${z.slice(8, 10)}` : undefined, title: partial ? `${m}, de ${ddmm(a)} a ${ddmm(z)}` : m, partial };
}

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
            <h2>Faturamento e lucro {UNIT[o.step].per}</h2>
            <span className="muted">
              {money(c.revenue)} no período
              {o.series.length > 1 && ` · média ${money(String(n(c.revenue) / o.series.length))} ${UNIT[o.step].each}`}
            </span>
          </div>
          {o.groups.length > 1 && (
            <nav className="segmented" aria-label="Agrupar barras por">
              {GROUPS.filter((g) => o.groups.includes(g.step)).map((g) => (
                <Link key={g.key} href={panelLink("/painel", params, { agrupar: g.key })} className={o.step === g.step ? "active" : ""} scroll={false}>{g.label}</Link>
              ))}
            </nav>
          )}
        </div>
        <GroupedBarChart
          points={o.series.map((s) => {
            const b = bucket(s.key, o.step, o.range.from, o.range.to);
            return { label: b.label, sub: b.sub, title: b.title, partial: b.partial, value: n(s.revenue), detail: `${s.count} ${s.count === 1 ? "venda" : "vendas"}` };
          })}
          second={{ name: "Lucro bruto", values: o.series.map((s) => n(s.profit)) }}
          labels={{ current: "Faturamento" }}
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
