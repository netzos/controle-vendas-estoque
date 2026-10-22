import Link from "next/link";
import { HEALTH_LABELS, listPlatformOrganizationRows, type OrganizationHealth } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { CreateOrganizationForm } from "./forms";
import { HEALTH_TONE, sinceLabel } from "./health";

export const metadata = { title: "Empresas" };

const FILTERS: Array<{ key: string; label: string; has: OrganizationHealth[] }> = [
  { key: "todas", label: "Todas", has: ["active", "cooling", "idle", "never", "suspended", "team"] },
  { key: "em-uso", label: "Em uso", has: ["active"] },
  { key: "atencao", label: "Precisam de atenção", has: ["cooling", "idle", "never"] },
  { key: "suspensas", label: "Suspensas", has: ["suspended"] },
];

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return current > 0 ? <span className="delta up">novo</span> : null;
  const pct = ((current - previous) / previous) * 100;
  const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  return <span className={`delta ${dir}`} title="Comparado aos 30 dias anteriores">{dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {Math.abs(pct).toFixed(0)}%</span>;
}

// Só o administrador da plataforma abre esta tela.
export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string; nova?: string }> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const all = await listPlatformOrganizationRows(db(), actor.userId);
  const filter = FILTERS.find((f) => f.key === sp.filtro) ?? FILTERS[0]!;
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = all
    .filter((o) => filter.has.includes(o.health))
    .filter((o) => !q || [o.name, o.ownerName, o.ownerEmail].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime());
  const count = (f: (typeof FILTERS)[number]) => all.filter((o) => f.has.includes(o.health)).length;
  const href = (p: { filtro?: string; q?: string }) => {
    const s = new URLSearchParams();
    const merged = { filtro: filter.key === "todas" ? undefined : filter.key, q: sp.q, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) s.set(k, v);
    return `/plataforma/empresas${s.size ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="page-header">
        <h1>Empresas</h1>
        <p>Todas as empresas que usam o netzsales. Toque numa empresa para ver a ficha completa: uso, pessoas, vendas, liberações e o que ela pediu.</p>
      </div>

      <div className="kpi-grid compact four">
        <div className="kpi"><span className="kpi-label">Em uso</span><span className="kpi-value">{all.filter((o) => o.health === "active").length}</span><span className="kpi-foot">alguém usou nos últimos 3 dias</span></div>
        <div className="kpi"><span className="kpi-label">Esfriando</span><span className="kpi-value">{all.filter((o) => o.health === "cooling").length}</span><span className="kpi-foot">sem uso há 4 a 14 dias</span></div>
        <div className="kpi"><span className="kpi-label">Paradas ou nunca usaram</span><span className="kpi-value">{all.filter((o) => o.health === "idle" || o.health === "never").length}</span><span className="kpi-foot">vale um contato</span></div>
        <div className="kpi"><span className="kpi-label">Pedidos de melhoria em aberto</span><span className="kpi-value">{all.reduce((n, o) => n + o.improvementsOpen, 0)}</span><span className="kpi-foot">somando todas</span></div>
      </div>

      <details className="card" open={sp.nova === "1"}>
        <summary>Nova empresa <span className="edit-hint">Abrir ›</span></summary>
        <p className="muted">Crie uma empresa direto aqui (sem passar pelo pedido de cadastro) e mande ao dono o link para criar a senha.</p>
        <CreateOrganizationForm />
      </details>

      <section className="card">
        <div className="imp-toolbar">
          <nav className="imp-tabs" aria-label="Situação">
            {FILTERS.map((f) => (
              <Link key={f.key} href={href({ filtro: f.key === "todas" ? "" : f.key })} className={f.key === filter.key ? "active" : ""}>
                {f.label} <span>{count(f)}</span>
              </Link>
            ))}
          </nav>
          <form method="get" className="org-search">
            {filter.key !== "todas" && <input type="hidden" name="filtro" value={filter.key} />}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar empresa, dono ou e-mail" aria-label="Buscar" />
          </form>
        </div>
        {shown.length === 0 ? (
          <p className="chart-empty">Nenhuma empresa aqui.</p>
        ) : (
          <div className="table-wrap">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Situação</th>
                  <th>Último uso</th>
                  <th>Pessoas</th>
                  <th>Vendas (30 dias)</th>
                  <th>Valor (30 dias)</th>
                  <th>Netz</th>
                  <th>Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/plataforma/empresas/${o.id}`} className="org-link">{o.name}</Link>
                      <div className="muted">{o.ownerName ? `${o.ownerName} · ${o.ownerEmail}` : "sem dono"}</div>
                    </td>
                    <td><span className={`tag ${HEALTH_TONE[o.health]}`}>{HEALTH_LABELS[o.health]}</span></td>
                    <td>{sinceLabel(o.lastActivityAt)}</td>
                    <td>{o.usersActive7d} de {o.usersTotal} <span className="muted">na semana</span></td>
                    <td>{o.sales30d} <Delta current={o.sales30d} previous={o.salesPrev30d} /></td>
                    <td>{money(o.revenue30d)}</td>
                    <td>{o.netzMessages30d}</td>
                    <td>{o.improvementsOpen || <span className="muted">0</span>}</td>
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
