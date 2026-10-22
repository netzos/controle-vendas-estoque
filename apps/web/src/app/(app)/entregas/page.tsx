import Link from "next/link";
import { can, listSaleSteps, orgDate, stepCounts } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { Kpi } from "@/components/charts";
import { StepRow } from "./steps";

export const metadata = { title: "Entregas e serviços" };

const FILTERS = [
  { key: "open", label: "Abertas" },
  { key: "late", label: "Atrasadas" },
  { key: "today", label: "Para hoje" },
  { key: "done", label: "Feitas" },
  { key: "all", label: "Todas" },
] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ filtro?: string; etapa?: string }> }) {
  const actor = await requirePermission("deliveries.view");
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filtro) ?? FILTERS[0];
  const [counts, steps, today] = await Promise.all([
    query(stepCounts, {}),
    query(listSaleSteps, { filter: filter.key, name: params.etapa || undefined }),
    query(orgDate, {}),
  ]);
  const canManage = can(actor, "deliveries.manage");
  const names = [...new Set(steps.map((s) => s.name))];
  const href = (f: string, etapa?: string) => `/entregas?filtro=${f}${etapa ? `&etapa=${encodeURIComponent(etapa)}` : ""}`;

  return (
    <>
      <div className="page-header">
        <h1>Entregas e serviços</h1>
        <p>O que ainda falta depois da venda: encomendar, entregar, instalar, montar. Cada produto diz quais etapas tem; a lista e os padrões ficam em <Link href="/etapas">Etapas depois da venda</Link>.</p>
      </div>

      <div className="kpi-grid">
        <Kpi hero label="Atrasadas" value={String(counts.late)} sub={counts.late ? "passaram do prazo" : "nada atrasado"} tone={counts.late ? "warn" : undefined} />
        <Kpi label="Para hoje" value={String(counts.today)} />
        <Kpi label="A fazer" value={String(counts.pending)} sub={`${counts.inProgress} em andamento`} />
        <Kpi label="Feitas em 7 dias" value={String(counts.doneWeek)} />
      </div>

      <section className="card">
        <div className="card-head">
          <nav className="segmented" aria-label="Filtro">
            {FILTERS.map((f) => (
              <Link key={f.key} href={href(f.key, params.etapa)} className={f.key === filter.key ? "active" : ""}>{f.label}</Link>
            ))}
          </nav>
          {(names.length > 1 || params.etapa) && (
            <nav className="segmented" aria-label="Etapa">
              <Link href={href(filter.key)} className={!params.etapa ? "active" : ""}>Todas as etapas</Link>
              {(params.etapa && !names.includes(params.etapa) ? [...names, params.etapa] : names).map((n) => (
                <Link key={n} href={href(filter.key, n)} className={params.etapa === n ? "active" : ""}>{n}</Link>
              ))}
            </nav>
          )}
        </div>
        {steps.length === 0 ? (
          <p className="chart-empty">
            {filter.key === "open" ? "Nada pendente. Para uma venda nascer com etapas, diga no cadastro do produto o que vem depois da venda." : "Nenhuma etapa aqui."}
          </p>
        ) : (
          <ul className="step-list">
            {steps.map((s) => <StepRow key={s.id} step={s} today={today} canManage={canManage} />)}
          </ul>
        )}
      </section>
    </>
  );
}
