import Link from "next/link";
import { dashboardCustomersPanel, getOrganization } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money } from "@/lib/format";
import { Kpi, RankList, SplitBar } from "@/components/charts";
import { dayLabel, PanelHeader, parseFilters, phoneLink, type PanelParams } from "../filters";

export const metadata = { title: "Painel · Clientes" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function PanelCustomers({ searchParams }: { searchParams: Promise<PanelParams> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const filters = parseFilters(params);
  const [d, org] = await Promise.all([query(dashboardCustomersPanel, filters), query(getOrganization, {})]);
  const n = (v: string) => Number(v);
  const b = d.buyers;

  return (
    <>
      <PanelHeader actor={actor} path="/painel/clientes" params={params} filters={filters} range={d.range} />

      <div className="kpi-grid compact four">
        <Kpi label="Clientes que compraram" value={String(b.total)} sub={d.anonymous.count ? `+ ${plural(d.anonymous.count, "venda", "vendas")} sem cliente` : undefined} />
        <Kpi label="Clientes novos" value={String(b.new)} sub={`primeira compra no período · ${money(b.newRevenue)}`} />
        <Kpi label="Voltaram a comprar" value={String(b.returning)} sub={money(b.returningRevenue)} />
        <Kpi label="Volta em média a cada" value={d.returnDays ? `${d.returnDays} ${d.returnDays === "1" ? "dia" : "dias"}` : "—"} sub="de quem comprou 2 vezes ou mais" />
      </div>

      <div className="dash-grid">
        <section className="card">
          <div className="card-head"><h2>Novos x que voltaram</h2></div>
          <SplitBar
            parts={[
              { label: "Voltaram", value: n(b.returningRevenue), sub: plural(b.returning, "cliente", "clientes") },
              { label: "Novos", value: n(b.newRevenue), sub: plural(b.new, "cliente", "clientes") },
              { label: "Sem cliente", value: n(d.anonymous.revenue), sub: plural(d.anonymous.count, "venda", "vendas") },
            ]}
          />
          <p className="muted small-note">Divisão do faturamento do período.</p>
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Melhores clientes</h2></div>
          <RankList
            emptyText="Ainda não há vendas com cliente no período."
            rows={d.top.map((c) => ({ key: c.customerId, label: c.name, value: money(c.revenue), sub: `${plural(c.count, "compra", "compras")} · última ${dayLabel(c.lastPurchase)}`, ratio: n(c.revenue) / n(d.top[0]!.revenue) }))}
          />
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>Clientes sumidos</h2>
            <span className="muted">compraram 2 vezes ou mais e não voltam há 45 dias</span>
          </div>
          {d.gone.length === 0 ? (
            <p className="chart-empty">Ninguém sumiu. Seus clientes estão voltando.</p>
          ) : (
            <ul className="mini-list">
              {d.gone.map((c) => {
                const wa = phoneLink(c.phone, `Olá, ${c.name.split(" ")[0]}! Aqui é da ${org.name}. Faz tempo que você não aparece, temos novidades para você.`);
                return (
                  <li key={c.customerId}>
                    <Link href={`/clientes?id=${c.customerId}`}>
                      <strong>{c.name}</strong> <span className="muted">{c.daysAway} dias sem comprar · {plural(c.count, "compra", "compras")} · {money(c.revenue)}</span>
                    </Link>
                    {wa ? <a className="button secondary small" href={wa} target="_blank" rel="noreferrer">Chamar no WhatsApp</a> : <span className="muted">sem telefone</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Por cidade</h2></div>
          <RankList
            emptyText="Cadastre a cidade dos clientes para ver aqui."
            rows={d.cities.map((c) => ({ key: c.city, label: c.city, value: money(c.revenue), sub: plural(c.customers, "cliente", "clientes"), ratio: n(c.revenue) / n(d.cities[0]!.revenue) }))}
          />
        </section>
      </div>
    </>
  );
}
