import { dashboardSalesPanel, enabledFeatures, FULFILLMENTS } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { BarChart, Heatmap, Kpi, RankList, SplitBar } from "@/components/charts";
import { dayLabel, PanelHeader, parseFilters, WEEKDAYS, WEEKDAYS_SHORT, type PanelParams } from "../filters";

export const metadata = { title: "Painel · Vendas" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function PanelSales({ searchParams }: { searchParams: Promise<PanelParams> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const filters = parseFilters(params);
  const [s, features] = await Promise.all([query(dashboardSalesPanel, filters), enabledFeatures(db(), actor.organizationId)]);
  const n = (v: string) => Number(v);
  const total = s.series.reduce((a, p) => a + n(p.revenue), 0);
  const bestWeekday = [...s.weekdays].sort((a, b) => n(b.average) - n(a.average))[0];
  const bestHour = (() => {
    const byHour = new Map<number, number>();
    for (const h of s.heatmap) byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + n(h.revenue));
    return [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  })();
  // Segunda primeiro, como no calendário de quem trabalha.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const weekdays = order.map((d) => s.weekdays.find((w) => w.weekday === d)!).filter(Boolean);

  return (
    <>
      <PanelHeader actor={actor} path="/painel/vendas" params={params} filters={filters} range={s.range} sellers={s.sellers} />

      <div className="kpi-grid compact four">
        <Kpi label="Melhor dia da semana" value={bestWeekday && n(bestWeekday.revenue) > 0 ? WEEKDAYS[bestWeekday.weekday]! : "—"} sub={bestWeekday && n(bestWeekday.revenue) > 0 ? `média de ${money(bestWeekday.average)} por dia` : undefined} />
        <Kpi label="Melhor horário" value={bestHour ? `${bestHour[0]}h às ${bestHour[0] + 1}h` : "—"} sub={bestHour ? `${money(bestHour[1])} no período` : undefined} />
        <Kpi label="Descontos" value={money(s.discounts.amount)} sub={s.discounts.count ? `${plural(s.discounts.count, "venda", "vendas")}${s.discounts.share ? ` · ${s.discounts.share.replace(".", ",")}% do bruto` : ""}` : "nenhum desconto"} />
        <Kpi label="Cancelamentos" value={String(s.cancellations.count)} tone={s.cancellations.count > 0 ? "warn" : undefined} sub={s.cancellations.count ? money(s.cancellations.amount) : "nenhuma venda cancelada"} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Melhores dias e horários</h2>
          <span className="muted">quanto mais escuro, mais vendeu</span>
        </div>
        <Heatmap
          rows={WEEKDAYS_SHORT.map((_, i) => WEEKDAYS_SHORT[order[i]!]!)}
          cells={s.heatmap.map((h) => ({ row: order.indexOf(h.weekday), col: h.hour, value: n(h.revenue), count: h.count }))}
          format={money}
        />
      </section>

      <div className="dash-grid">
        <section className="card span-2">
          <div className="card-head">
            <h2>Faturamento {s.step === "hour" ? "por hora" : s.step === "day" ? "por dia" : s.step === "week" ? "por semana" : "por mês"}</h2>
            <span className="muted">{money(total)}</span>
          </div>
          <BarChart data={s.series.map((p) => ({ label: p.label, value: n(p.revenue), detail: plural(p.count, "venda", "vendas") }))} format={money} emptyText="Nenhuma venda neste período." />
        </section>

        <section className="card">
          <div className="card-head"><h2>Melhores dias</h2></div>
          <RankList
            emptyText="Os dias que mais venderam aparecem aqui."
            rows={s.bestDays.map((d) => ({ key: d.day, label: dayLabel(d.day), value: money(d.revenue), sub: plural(d.count, "venda", "vendas"), ratio: n(d.revenue) / n(s.bestDays[0]!.revenue) }))}
          />
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>Média por dia da semana</h2>
            <span className="muted">faturamento ÷ quantas vezes o dia apareceu</span>
          </div>
          <BarChart data={weekdays.map((w) => ({ label: WEEKDAYS_SHORT[w.weekday]!, value: n(w.average), detail: `${plural(w.count, "venda", "vendas")} em ${plural(w.days, "dia", "dias")}` }))} format={money} height={200} />
        </section>

        <section className="card">
          <div className="card-head"><h2>Por vendedor</h2></div>
          <RankList
            emptyText="Sem vendas no período."
            rows={s.sellers.map((v) => ({ key: v.id, label: v.name, value: money(v.revenue), sub: `${plural(v.count, "venda", "vendas")} · ticket ${money(v.ticket)}`, ratio: n(v.revenue) / n(s.sellers[0]!.revenue) }))}
          />
        </section>

        {s.branches.length > 1 && (
          <section className="card">
            <div className="card-head"><h2>Por filial</h2></div>
            <RankList
              emptyText="Sem vendas no período."
              rows={s.branches.map((b) => ({ key: b.id ?? "none", label: b.name, value: money(b.revenue), sub: plural(b.count, "venda", "vendas"), ratio: n(b.revenue) / n(s.branches[0]!.revenue) }))}
            />
          </section>
        )}

        {features.has("deliveries") && (
          <section className="card">
            <div className="card-head"><h2>Retirada x entrega</h2></div>
            <SplitBar
              parts={(["pickup", "delivery"] as const).map((k) => ({ label: FULFILLMENTS[k], value: s.fulfillment[k].count, sub: `${plural(s.fulfillment[k].count, "venda", "vendas")} · ${money(s.fulfillment[k].revenue)}` }))}
            />
          </section>
        )}

        <section className="card">
          <div className="card-head"><h2>Por que cancelaram</h2></div>
          {s.cancellations.reasons.length === 0 ? (
            <p className="chart-empty">Nenhuma venda cancelada no período.</p>
          ) : (
            <ul className="mini-list">
              {s.cancellations.reasons.map((r) => (
                <li key={r.reason}><span>{r.reason}</span><span className="muted">{plural(r.count, "vez", "vezes")}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
