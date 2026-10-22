import Link from "next/link";
import { HEALTH_LABELS, listPlatformOrganizationRows, platformDashboard, type OrganizationHealth } from "@erp/core";
import { BarChart, Kpi, RankList } from "@/components/charts";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { sinceLabel } from "./empresas/health";
import { percent } from "./ui";

export const metadata = { title: "Painel da plataforma" };

const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const dayLabel = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const count = (v: number) => new Intl.NumberFormat("pt-BR").format(v);

export default async function PlatformDashboardPage() {
  const actor = await requireDeveloper();
  const [d, orgs] = await Promise.all([platformDashboard(db(), actor.userId), listPlatformOrganizationRows(db(), actor.userId)]);
  const customers = orgs.filter((o) => o.kind === "customer");
  const rate = d.money.usdBrl;

  // Dinheiro do mês: mensalidades menos custo de uso (30 dias, em reais) e custos fixos.
  const usageBrl = d.money.usageCustomers30dUsd * rate;
  const internalBrl = d.money.usageInternal30dUsd * rate;
  const costBrl = usageBrl + internalBrl + d.money.fixedMonthlyBrl;
  const profit = d.money.mrr - costBrl;
  const payingCount = d.money.paying + d.money.overdue;

  const health = (h: OrganizationHealth) => customers.filter((o) => o.health === h).length;
  const attention = customers
    .filter((o) => o.health === "cooling" || o.health === "idle" || o.health === "never")
    .sort((a, b) => new Date(a.lastActivityAt ?? a.createdAt).getTime() - new Date(b.lastActivityAt ?? b.createdAt).getTime());
  const overdue = customers.filter((o) => o.status === "active" && o.billingStatus === "overdue");
  const losing = customers
    .map((o) => ({ o, margin: Number(o.monthlyPrice) - Number(o.usageCost30dUsd) * rate }))
    .filter((x) => Number(x.o.usageCost30dUsd) > 0)
    .sort((a, b) => Number(b.o.usageCost30dUsd) - Number(a.o.usageCost30dUsd))
    .slice(0, 5);
  const topCost = Math.max(...losing.map((x) => Number(x.o.usageCost30dUsd)), 0);
  const topSales = [...customers].filter((o) => Number(o.revenue30d) > 0).sort((a, b) => Number(b.revenue30d) - Number(a.revenue30d)).slice(0, 5);
  const topRevenue = Number(topSales[0]?.revenue30d ?? 0);

  const todo = [
    d.signups.pending > 0 && { href: "/plataforma/pedidos", n: d.signups.pending, text: d.signups.pending === 1 ? "pedido de cadastro esperando você" : "pedidos de cadastro esperando você" },
    overdue.length > 0 && { href: "/plataforma/financeiro?filtro=atraso", n: overdue.length, text: overdue.length === 1 ? "empresa com mensalidade em atraso" : "empresas com mensalidade em atraso" },
    attention.length > 0 && { href: "/plataforma/empresas?filtro=atencao", n: attention.length, text: attention.length === 1 ? "empresa esfriando, parada ou que nunca usou" : "empresas esfriando, paradas ou que nunca usaram" },
    d.usage.improvementsOpen > 0 && { href: "/plataforma/melhorias", n: d.usage.improvementsOpen, text: d.usage.improvementsOpen === 1 ? "pedido de melhoria em aberto" : "pedidos de melhoria em aberto" },
  ].filter(Boolean) as Array<{ href: string; n: number; text: string }>;

  return (
    <>
      <div className="page-header">
        <h1>Painel da plataforma</h1>
        <p>Como está o netzsales: clientes, crescimento, uso, receita e custos. Só empresas de clientes entram nos números; as da equipe ficam de fora.</p>
      </div>

      <section className="card todo-card">
        <h2>Precisa de você</h2>
        {todo.length === 0 ? (
          <p className="muted">Tudo em dia. Nenhum pedido esperando, nenhuma empresa em risco.</p>
        ) : (
          <ul className="todo-list">
            {todo.map((t) => (
              <li key={t.href}><Link href={t.href}><strong>{count(t.n)}</strong> {t.text} ›</Link></li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="section-title">Crescimento</h2>
      <div className="kpi-grid">
        <Kpi hero label="Empresas clientes ativas" value={count(d.companies.active)} sub={d.companies.suspended ? `${d.companies.suspended} suspensa(s)` : "nenhuma suspensa"} />
        <Kpi label="Novas empresas (30 dias)" value={count(d.companies.new30d)} current={d.companies.new30d} previous={d.companies.newPrev30d} sub="vs. 30 dias anteriores" />
        <Kpi label="Empresas usando na semana" value={count(d.companies.activeLast7d)} current={d.companies.activeLast7d} previous={d.companies.activePrev7d} sub={`${percent(d.companies.activeLast7d, d.companies.active)} das ativas`} />
        <Kpi label="Pessoas usando na semana" value={count(d.users.last7d)} sub={`${count(d.users.today)} hoje · ${count(d.users.last30d)} no mês · ${count(d.users.total)} no total`} />
      </div>

      <h2 className="section-title">Receita e custos <Link href="/plataforma/financeiro" className="muted small-link">ver detalhes ›</Link></h2>
      <div className="kpi-grid">
        <Kpi hero label="Receita mensal (mensalidades)" value={money(d.money.mrr)} sub={`${payingCount} pagando · ${d.money.trial} em teste · ${d.money.free} cortesia`} />
        <Kpi label="Custo do mês" value={money(costBrl)} sub={`uso ${money(usageBrl + internalBrl)} · fixos ${money(d.money.fixedMonthlyBrl)}`} />
        <Kpi label="Lucro do mês" value={money(profit)} tone={profit < 0 ? "bad" : undefined} sub={d.money.mrr > 0 ? `margem de ${percent(profit, d.money.mrr)}` : "ainda sem mensalidades"} />
        <Kpi label="Média por empresa pagante" value={payingCount ? money(d.money.mrr / payingCount) : "—"} sub={`custo de uso médio ${customers.length ? money(usageBrl / customers.length) : "—"} por empresa`} />
      </div>

      <div className="dash-grid two">
        <section className="card">
          <div className="card-head"><h2>Empresas usando por semana</h2><span className="muted">últimas 12 semanas</span></div>
          <BarChart
            data={d.weekly.map((w) => ({ label: dayLabel.format(new Date(`${w.week}T00:00:00Z`)), value: w.activeCompanies, detail: "semana começando nesse dia" }))}
            format={(v) => `${count(v)} ${v === 1 ? "empresa" : "empresas"}`}
            emptyText="Nenhuma empresa cliente usou o sistema nessas semanas."
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Novas empresas por mês</h2><span className="muted">últimos 12 meses</span></div>
          <BarChart
            data={d.monthly.map((m) => ({ label: monthLabel.format(new Date(`${m.month}-01T00:00:00Z`)), value: m.newCompanies, detail: `${m.newUsers} pessoas novas` }))}
            format={(v) => `${count(v)} ${v === 1 ? "empresa" : "empresas"}`}
            emptyText="Nenhuma empresa nova nesse período."
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Custo de uso por mês</h2><span className="muted">IA e áudio, em reais</span></div>
          <BarChart
            data={d.monthly.map((m) => ({ label: monthLabel.format(new Date(`${m.month}-01T00:00:00Z`)), value: m.costUsd * rate }))}
            format={money}
            emptyText="Ainda sem custo de uso registrado. Ele começa a contar a partir de agora."
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Vendas registradas pelos clientes</h2><span className="muted">valor por mês</span></div>
          <BarChart
            data={d.monthly.map((m) => ({ label: monthLabel.format(new Date(`${m.month}-01T00:00:00Z`)), value: m.gmv }))}
            format={money}
            emptyText="Os clientes ainda não registraram vendas."
          />
        </section>
      </div>

      <div className="dash-grid">
        <section className="card">
          <h2>Saúde da base</h2>
          <RankList
            emptyText="Nenhuma empresa cliente ainda."
            rows={(["active", "cooling", "idle", "never", "suspended"] as const).map((h) => ({
              key: h,
              label: HEALTH_LABELS[h],
              value: count(health(h)),
              ratio: customers.length ? health(h) / customers.length : 0,
            }))}
          />
          <p className="muted small-text">Em uso: alguém usou nos últimos 3 dias. Esfriando: 4 a 14 dias. Parada: mais de 14 dias.</p>
        </section>
        <section className="card">
          <h2>Entrada de clientes</h2>
          <dl className="org-facts">
            <dt>Pedidos (30 dias)</dt><dd>{count(d.signups.last30d)} · {count(d.signups.approved30d)} aprovados · {count(d.signups.rejected30d)} recusados</dd>
            <dt>Tempo para decidir</dt><dd>{d.signups.avgHoursToDecide !== null ? `${String(d.signups.avgHoursToDecide).replace(".", ",")} h em média` : "—"}</dd>
            <dt>Ativação</dt><dd>{percent(d.activation.withSale90d, d.activation.created90d)} das novas empresas (90 dias) já registraram venda</dd>
            <dt>Até a 1ª venda</dt><dd>{d.activation.medianDaysToFirstSale !== null ? `${String(d.activation.medianDaysToFirstSale).replace(".", ",")} dias (mediana)` : "—"}</dd>
            <dt>Pessoas novas</dt><dd>{count(d.users.new30d)} em 30 dias · {count(d.users.never)} nunca entraram</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Uso do sistema (30 dias)</h2>
          <dl className="org-facts">
            <dt>Vendas registradas</dt><dd>{count(d.usage.sales30d)} <span className="muted">(antes: {count(d.usage.salesPrev30d)})</span></dd>
            <dt>Valor vendido</dt><dd>{money(d.usage.gmv30d)} <span className="muted">(antes: {money(d.usage.gmvPrev30d)})</span></dd>
            <dt>Mensagens para a Netz</dt><dd>{count(d.usage.netzMessages30d)}</dd>
            <dt>Telegram ligado</dt><dd>{count(d.usage.telegramLinks)} {d.usage.telegramLinks === 1 ? "pessoa" : "pessoas"}</dd>
            <dt>Empresas ativas no mês</dt><dd>{count(d.companies.activeLast30d)} de {count(d.companies.active)}</dd>
          </dl>
        </section>
      </div>

      <div className="dash-grid two spaced">
        <section className="card">
          <div className="card-head"><h2>Precisam de atenção</h2><Link href="/plataforma/empresas?filtro=atencao" className="muted">Ver todas ›</Link></div>
          {attention.length === 0 ? (
            <p className="chart-empty">Nenhuma empresa esfriando ou parada.</p>
          ) : (
            <ul className="org-improvements">
              {attention.slice(0, 6).map((o) => (
                <li key={o.id}>
                  <Link href={`/plataforma/empresas/${o.id}`}>{o.name}</Link>
                  <span className={`tag ${o.health === "never" ? "off" : "warn"}`}>{HEALTH_LABELS[o.health]}</span>
                  <span className="muted">{o.ownerName ?? "sem dono"} · último uso {sinceLabel(o.lastActivityAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Quem mais custa (30 dias)</h2><Link href="/plataforma/financeiro" className="muted">Receita e custos ›</Link></div>
          <RankList
            emptyText="Ainda sem custo de uso registrado."
            rows={losing.map(({ o, margin }) => ({
              key: o.id,
              label: o.name,
              value: money(Number(o.usageCost30dUsd) * rate),
              sub: `paga ${money(o.monthlyPrice)} · ${margin >= 0 ? "sobra" : "falta"} ${money(Math.abs(margin))}`,
              ratio: topCost ? Number(o.usageCost30dUsd) / topCost : 0,
            }))}
          />
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Empresas que mais vendem (30 dias)</h2><Link href="/plataforma/empresas?ordem=vendas" className="muted">Ver todas ›</Link></div>
        <RankList
          emptyText="Nenhuma venda de cliente nos últimos 30 dias."
          rows={topSales.map((o) => ({
            key: o.id,
            label: o.name,
            value: money(o.revenue30d),
            sub: `${count(o.sales30d)} vendas`,
            ratio: topRevenue ? Number(o.revenue30d) / topRevenue : 0,
          }))}
        />
      </section>
    </>
  );
}
