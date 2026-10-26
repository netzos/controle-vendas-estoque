import Link from "next/link";
import { can, enabledFeatures, FULFILLMENTS, getOrganization, PAYMENT_LABELS, salesDashboard, stepCounts, stockOverview, telegramConfigured, telegramOrganizationOf, type SalesPeriod } from "@erp/core";
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
  const features = await enabledFeatures(db(), actor.organizationId);
  const canCosts = features.has("costs") && can(actor, "costs.view");
  const telegramReady = can(actor, "nets.use") && telegramConfigured() && !actor.platformView && features.has("telegram");
  const [org, dash, stock, steps, telegramPending] = await Promise.all([
    query(getOrganization, {}),
    canSales ? query(salesDashboard, { period: period.key }) : null,
    canStock ? query(stockOverview, {}) : null,
    features.has("deliveries") && can(actor, "deliveries.view") ? query(stepCounts, {}) : null,
    // Cartão de boas-vindas da Netz no Telegram até a pessoa ligar a conta.
    telegramReady ? telegramOrganizationOf(db(), actor.userId).then((linkedTo) => !linkedTo) : false,
  ]);
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const alerts = stock?.rows.filter((r) => r.status === "out" || r.status === "low").sort((a, b) => Number(a.stockQty) - Number(b.stockQty)) ?? [];

  // "Precisa de você": o que pede ação hoje, no mesmo espírito do cartão do Painel da plataforma.
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const owed = stock?.rows.filter((r) => Number(r.stockQty) < 0).length ?? 0;
  const out = (stock?.rows.filter((r) => r.status === "out").length ?? 0) - owed;
  const low = stock?.rows.filter((r) => r.status === "low").length ?? 0;
  const needs: { href: string; text: string; action: string; tone: "bad" | "warn" }[] = [];
  if (steps && steps.late > 0) needs.push({ href: "/entregas?filtro=late", text: `${plural(steps.late, "entrega ou serviço atrasado", "entregas ou serviços atrasados")}`, action: "Resolver", tone: "bad" });
  if (steps && steps.today > 0) needs.push({ href: "/entregas?filtro=today", text: `${plural(steps.today, "entrega ou serviço", "entregas ou serviços")} para hoje`, action: "Ver", tone: "warn" });
  if (dash && dash.receivable.count > 0) needs.push({ href: "/vendas?receber=1", text: `${money(dash.receivable.amount)} para receber em ${plural(dash.receivable.count, "venda", "vendas")}`, action: "Ver", tone: "warn" });
  if (owed > 0) needs.push({ href: "/estoque?filtro=zerados", text: `${plural(owed, "produto vendido por encomenda", "produtos vendidos por encomenda")}, falta pedir ao fornecedor`, action: "Ver", tone: "bad" });
  if (out > 0) needs.push({ href: "/estoque?filtro=zerados", text: `${plural(out, "produto zerado", "produtos zerados")}`, action: "Repor", tone: "bad" });
  if (low > 0) needs.push({ href: "/estoque?filtro=baixo", text: `${plural(low, "produto abaixo do mínimo", "produtos abaixo do mínimo")}`, action: "Repor", tone: "warn" });

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

      {needs.length > 0 && (
        <section className="card needs">
          <h2>Precisa de você</h2>
          <ul>
            {needs.map((n) => (
              <li key={n.text}>
                <Link href={n.href}>
                  <span className={`needs-dot ${n.tone}`} aria-hidden="true" />
                  <span>{n.text}</span>
                  <span className="muted">{n.action} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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

{features.has("deliveries") && (
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
            )}

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
                        {Number(r.stockQty) < 0 ? `Faltam ${quantity(String(-Number(r.stockQty)))} ${r.unitCode}` : r.status === "out" ? "Zerado" : `${quantity(r.stockQty)} ${r.unitCode}`}
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
                        <strong>nº {s.number}</strong> <span className="muted">{s.customerName ?? "Consumidor"} · {timeFmt.format(s.soldAt)}</span>
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
