import Link from "next/link";
import {
  BILLING_LABELS,
  listPlatformFixedCosts,
  listPlatformOrganizationRows,
  platformUsageSummary,
  platformUsdBrl,
  type PlatformOrganizationRow,
} from "@erp/core";
import { Kpi, RankList } from "@/components/charts";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { hrefWith, pageOf, Pager, percent } from "../ui";
import { FixedCostForm, UsdBrlForm } from "./forms";

export const metadata = { title: "Receita e custos" };

const DAY = 24 * 60 * 60 * 1000;

const FEATURE_LABELS: Record<string, string> = {
  netz: "Netz (conversas com a IA)",
  telegram_audio: "Áudios no Telegram",
  panel_audio: "Áudios no painel",
  improvements_analysis: "Análise de melhorias com IA",
  nets_guidance: "Propostas para o manual da Netz",
};

type Row = { o: PlatformOrganizationRow; cost: number; margin: number };

const FILTERS: Array<{ key: string; label: string; test: (r: Row) => boolean }> = [
  { key: "todas", label: "Todas", test: () => true },
  { key: "pagando", label: "Pagando", test: (r) => r.o.billingStatus === "paying" },
  { key: "atraso", label: "Em atraso", test: (r) => r.o.billingStatus === "overdue" },
  { key: "teste", label: "Em teste", test: (r) => r.o.billingStatus === "trial" },
  { key: "cortesia", label: "Cortesia", test: (r) => r.o.billingStatus === "free" },
  { key: "prejuizo", label: "Dando prejuízo", test: (r) => r.margin < 0 },
];

type Search = { filtro?: string; pagina?: string };

export default async function PlatformMoneyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const [orgs, rate, fixed, usage] = await Promise.all([
    listPlatformOrganizationRows(db(), actor.userId),
    platformUsdBrl(db()),
    listPlatformFixedCosts(db(), actor.userId),
    platformUsageSummary(db(), actor.userId, new Date(Date.now() - 30 * DAY)),
  ]);
  const customers = orgs.filter((o) => o.kind === "customer");
  const internalIds = new Set(orgs.filter((o) => o.kind === "internal").map((o) => o.id));
  const rows: Row[] = customers.map((o) => {
    const cost = Number(o.usageCost30dUsd) * rate;
    return { o, cost, margin: (o.status === "active" ? Number(o.monthlyPrice) : 0) - cost };
  });
  const mrr = customers.filter((o) => o.status === "active" && (o.billingStatus === "paying" || o.billingStatus === "overdue")).reduce((n, o) => n + Number(o.monthlyPrice), 0);
  const usageCustomers = usage.filter((u) => !internalIds.has(u.organizationId)).reduce((n, u) => n + Number(u.costUsd), 0) * rate;
  const usageInternal = usage.filter((u) => internalIds.has(u.organizationId)).reduce((n, u) => n + Number(u.costUsd), 0) * rate;
  const fixedTotal = fixed.filter((f) => f.status === "active").reduce((n, f) => n + Number(f.monthlyBrl), 0);
  const profit = mrr - usageCustomers - usageInternal - fixedTotal;

  const byFeature = new Map<string, number>();
  for (const u of usage) byFeature.set(u.feature, (byFeature.get(u.feature) ?? 0) + Number(u.costUsd) * rate);
  const featureRows = [...byFeature.entries()].sort((a, b) => b[1] - a[1]);
  const topFeature = featureRows[0]?.[1] ?? 0;

  const filter = FILTERS.find((f) => f.key === sp.filtro) ?? FILTERS[0]!;
  const matched = rows.filter(filter.test).sort((a, b) => a.margin - b.margin);
  const page = pageOf(matched, sp.pagina);
  const current = { filtro: filter.key === "todas" ? undefined : filter.key };

  return (
    <>
      <div className="page-header">
        <h1>Receita e custos</h1>
        <p>
          Quanto cada empresa paga, quanto custa o uso dela (IA da Netz e áudios) e quanto sobra. A mensalidade é anotada na ficha de
          cada empresa; a cobrança automática e os planos por funcionalidade vêm depois, em cima destes mesmos números.
        </p>
      </div>

      <div className="kpi-grid">
        <Kpi hero label="Receita mensal" value={money(mrr)} sub="mensalidades de quem está pagando" />
        <Kpi label="Custo de uso (30 dias)" value={money(usageCustomers + usageInternal)} sub={`clientes ${money(usageCustomers)} · equipe ${money(usageInternal)}`} />
        <Kpi label="Custos fixos por mês" value={money(fixedTotal)} sub={`${fixed.filter((f) => f.status === "active").length} ${fixed.length === 1 ? "item" : "itens"}`} />
        <Kpi label="Lucro do mês" value={money(profit)} tone={profit < 0 ? "bad" : undefined} sub={mrr > 0 ? `margem de ${percent(profit, mrr)}` : "ainda sem mensalidades"} />
      </div>

      <section className="card">
        <div className="imp-toolbar">
          <h2>Por empresa</h2>
          <nav className="imp-tabs" aria-label="Situação da mensalidade">
            {FILTERS.map((f) => (
              <Link key={f.key} href={hrefWith("/plataforma/financeiro", {}, { filtro: f.key === "todas" ? undefined : f.key })} className={f.key === filter.key ? "active" : ""}>
                {f.label} <span>{rows.filter(f.test).length}</span>
              </Link>
            ))}
          </nav>
        </div>
        <p className="muted small-text">Da que menos sobra para a que mais sobra. Sobra = mensalidade menos custo de uso dos últimos 30 dias.</p>
        {page.rows.length === 0 ? (
          <p className="chart-empty">Nenhuma empresa aqui.</p>
        ) : (
          <div className="table-wrap">
            <table className="org-table">
              <thead><tr><th>Empresa</th><th>Situação</th><th>Mensalidade</th><th>Custo de uso (30 dias)</th><th>Sobra</th><th>Margem</th></tr></thead>
              <tbody>
                {page.rows.map(({ o, cost, margin }) => (
                  <tr key={o.id}>
                    <td><Link href={`/plataforma/empresas/${o.id}`} className="org-link">{o.name}</Link><div className="muted">{o.planName ?? "sem plano"}</div></td>
                    <td><span className={`tag ${o.billingStatus === "paying" ? "ok" : o.billingStatus === "overdue" ? "warn" : ""}`}>{BILLING_LABELS[o.billingStatus]}</span></td>
                    <td>{money(o.monthlyPrice)}</td>
                    <td>{money(cost)}</td>
                    <td className={margin < 0 ? "negative" : ""}>{money(margin)}</td>
                    <td>{Number(o.monthlyPrice) > 0 ? percent(margin, Number(o.monthlyPrice)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page.page} pages={page.pages} total={matched.length} href={(p) => hrefWith("/plataforma/financeiro", current, { pagina: String(p) })} />
      </section>

      <div className="dash-grid two">
        <section className="card">
          <div className="card-head"><h2>Custo de uso por tipo</h2><span className="muted">últimos 30 dias</span></div>
          <RankList
            emptyText="Ainda sem custo de uso. Ele começa a contar a partir de agora, a cada conversa com a Netz e a cada áudio."
            rows={featureRows.map(([k, v]) => ({ key: k, label: FEATURE_LABELS[k] ?? k, value: money(v), ratio: topFeature ? v / topFeature : 0 }))}
          />
        </section>
        <section className="card">
          <h2>Custos fixos da plataforma</h2>
          <p className="muted small-text">O que o netzsales paga todo mês, independente do uso: servidor, banco de dados, domínio, chip do WhatsApp...</p>
          {fixed.map((c) => <FixedCostForm key={c.id} cost={c} />)}
          <FixedCostForm />
          <h3>Cotação do dólar</h3>
          <p className="muted small-text">IA e áudio são cobrados em dólar; usamos esta cotação para mostrar em reais.</p>
          <UsdBrlForm rate={rate} />
        </section>
      </div>
    </>
  );
}
