import Link from "next/link";
import { can, enabledFeatures, FULFILLMENTS, getOrganization, listTelegramLinkedUsers, PAYMENT_LABELS, salesDashboard, stepCounts, stockOverview, telegramConfigured, type SalesPeriod } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { BarChart, Kpi, RankList } from "@/components/charts";
import { db } from "@/lib/db";
import { TelegramButton } from "./assistente/telegram/forms";

export const metadata = { title: "Início" };

const PERIODS: { key: SalesPeriod; label: string; previous: string }[] = [
  { key: "today", label: "Hoje", previous: "ontem" },
  { key: "7d", label: "7 dias", previous: "7 dias anteriores" },
  { key: "30d", label: "30 dias", previous: "30 dias anteriores" },
  { key: "month", label: "Este mês", previous: "mês passado" },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const actor = await currentActor();
  const params = await searchParams;
  const period = PERIODS.find((p) => p.key === params.periodo) ?? PERIODS[0]!;
  const canSales = can(actor, "sales.view");
  const canStock = can(actor, "stock.view");
  const canCosts = can(actor, "costs.view");
  const telegramReady = can(actor, "nets.use") && telegramConfigured() && !actor.platformView;
  const [org, dash, stock, steps, telegramPending] = await Promise.all([
    query(getOrganization, {}),
    canSales ? query(salesDashboard, { period: period.key }) : null,
    canStock ? query(stockOverview, {}) : null,
    can(actor, "deliveries.view") ? query(stepCounts, {}) : null,
    // Cartão de boas-vindas da Netz no Telegram até a pessoa ligar a conta.
    telegramReady
      ? Promise.all([enabledFeatures(db(), actor.organizationId), listTelegramLinkedUsers(db(), actor)]).then(([f, linked]) => f.has("telegram") && !linked.has(actor.userId))
      : false,
  ]);
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const alerts = stock?.rows.filter((r) => r.status === "out" || r.status === "low").sort((a, b) => Number(a.stockQty) - Number(b.stockQty)) ?? [];

  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>{org.name}</h1>
          <p>Olá, {actor.userName.split(" ")[0]}. {canSales ? `Vendas de ${period.label.toLowerCase()}.` : ""}</p>
        </div>
        <div className="dash-actions">
          {canSales && (
            <nav className="segmented" aria-label="Período">
              {PERIODS.map((p) => (
                <Link key={p.key} href={p.key === "today" ? "/" : `/?periodo=${p.key}`} className={p.key === period.key ? "active" : ""}>
                  {p.label}
                </Link>
              ))}
            </nav>
          )}
          {can(actor, "sales.create") && <Link className="button" href="/vendas/nova">+ Nova venda</Link>}
        </div>
      </div>

      {telegramPending && (
        <section className="card telegram-welcome">
          <div>
            <h2>Fale com a Netz no Telegram</h2>
            <p className="muted">
              Registre vendas, veja o estoque e lance custos conversando, por texto ou áudio. Toque no botão, depois em <strong>Iniciar</strong> no Telegram, e pronto.
            </p>
          </div>
          <TelegramButton linked={false} large />
        </section>
      )}

      {steps && (steps.late > 0 || steps.today > 0) && (
        <Link href={`/entregas?filtro=${steps.late > 0 ? "late" : "today"}`} className="card notice-link">
          <strong>Depois da venda:</strong>{" "}
          {[steps.late > 0 && `${steps.late} ${steps.late === 1 ? "etapa atrasada" : "etapas atrasadas"}`, steps.today > 0 && `${steps.today} para hoje`].filter(Boolean).join(" · ")}
          <span className="muted"> · ver entregas e serviços →</span>
        </Link>
      )}

      {dash && (
        <>
          <div className="kpi-grid">
            <Kpi hero label="Faturamento" value={money(dash.current.revenue)} current={Number(dash.current.revenue)} previous={Number(dash.previous.revenue)} sub={`vs. ${period.previous}`} />
            <Kpi label="Vendas" value={String(dash.current.count)} current={dash.current.count} previous={dash.previous.count} sub={`${quantity(dash.current.items)} itens`} />
            <Kpi label="Ticket médio" value={money(dash.current.ticket)} current={Number(dash.current.ticket)} previous={Number(dash.previous.ticket)} />
            {canCosts ? (
              <Kpi
                label="Lucro real"
                value={money(dash.current.realProfit)}
                current={Number(dash.current.realProfit)}
                previous={Number(dash.previous.realProfit)}
                sub={`bruto ${money(dash.current.profit)} · outros custos ${money(dash.current.otherCosts)}`}
              />
            ) : (
              <Kpi
                label="Lucro bruto"
                value={money(dash.current.profit)}
                current={Number(dash.current.profit)}
                previous={Number(dash.previous.profit)}
                sub={dash.current.margin ? `margem ${dash.current.margin.replace(".", ",")}%` : undefined}
              />
            )}
          </div>

          <div className="dash-grid">
            <section className="card span-2">
              <div className="card-head">
                <h2>{period.key === "today" ? "Faturamento por hora" : "Faturamento por dia"}</h2>
                <span className="muted">{money(dash.current.revenue)}</span>
              </div>
              <BarChart
                data={dash.series.map((s) => ({ label: s.label, value: Number(s.revenue), detail: `${s.count} ${s.count === 1 ? "venda" : "vendas"}` }))}
                format={money}
                emptyText="Nenhuma venda no período ainda."
              />
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Mais vendidos</h2>
                <Link href="/vendas" className="muted">Ver vendas</Link>
              </div>
              <RankList
                emptyText="Os produtos mais vendidos aparecem aqui."
                rows={dash.topProducts.map((p) => ({
                  key: p.productId,
                  label: p.name,
                  value: money(p.revenue),
                  sub: `${quantity(p.quantity)} ${p.unitCode} · ${p.share}% do faturamento`,
                  ratio: Number(p.revenue) / Number(dash.topProducts[0]!.revenue),
                }))}
              />
            </section>

            <section className="card">
              <div className="card-head"><h2>Retirada x entrega</h2></div>
              {(() => {
                const f = dash.fulfillment;
                const max = Math.max(f.pickup.count, f.delivery.count, 1);
                return (
                  <RankList
                    emptyText="Sem vendas no período."
                    rows={(["pickup", "delivery"] as const).filter((k) => f[k].count > 0).map((k) => ({
                      key: k,
                      label: FULFILLMENTS[k],
                      value: `${f[k].count} ${f[k].count === 1 ? "venda" : "vendas"}`,
                      sub: k === "delivery"
                        ? `${money(f[k].revenue)} · frete cobrado ${money(f[k].fees)} · transporte ${money(f[k].transport)}`
                        : money(f[k].revenue),
                      ratio: f[k].count / max,
                    }))}
                  />
                );
              })()}
            </section>

            <section className="card">
              <div className="card-head"><h2>Formas de pagamento</h2></div>
              <RankList
                emptyText="Sem vendas no período."
                rows={dash.payments.map((p) => ({
                  key: p.method,
                  label: PAYMENT_LABELS[p.method],
                  value: money(p.revenue),
                  sub: `${p.count} ${p.count === 1 ? "venda" : "vendas"}`,
                  ratio: Number(p.revenue) / Number(dash.payments[0]!.revenue),
                }))}
              />
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Estoque em alerta</h2>
                {canStock && <Link href="/estoque" className="muted">Painel do estoque</Link>}
              </div>
              {!stock ? (
                <p className="chart-empty">Sem acesso ao estoque.</p>
              ) : alerts.length === 0 ? (
                <p className="chart-empty">Tudo certo: nenhum produto zerado ou abaixo do mínimo.</p>
              ) : (
                <ul className="mini-list">
                  {alerts.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <span>{r.name}</span>
                      <span className={`tag ${r.status === "out" ? "off" : "warn"}`}>
                        {r.status === "out" ? "Zerado" : `${quantity(r.stockQty)} ${r.unitCode}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Últimas vendas</h2>
                <Link href="/vendas" className="muted">Todas</Link>
              </div>
              {dash.recent.length === 0 ? (
                <p className="chart-empty">Nenhuma venda registrada ainda.</p>
              ) : (
                <ul className="mini-list">
                  {dash.recent.map((s) => (
                    <li key={s.id}>
                      <Link href={`/vendas?id=${s.id}`}>
                        <strong>nº {s.number}</strong> <span className="muted">{timeFmt.format(s.soldAt)}</span>
                      </Link>
                      <span className={s.status === "cancelled" ? "strike muted" : ""}>{money(s.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {!dash && (
        <section className="card">
          <p className="muted">Seu perfil não tem acesso ao painel de vendas. Use o menu ao lado.</p>
        </section>
      )}
    </>
  );
}
