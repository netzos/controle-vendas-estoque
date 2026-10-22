import Link from "next/link";
import { BILLING_LABELS, HEALTH_LABELS, listPlatformOrganizationRows, platformUsdBrl, type OrganizationHealth, type PlatformOrganizationRow } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { hrefWith, pageOf, Pager } from "../ui";
import { CreateOrganizationForm } from "./forms";
import { HEALTH_TONE, sinceLabel } from "./health";

export const metadata = { title: "Empresas" };

const DAY = 24 * 60 * 60 * 1000;

const FILTERS: Array<{ key: string; label: string; test: (o: PlatformOrganizationRow) => boolean }> = [
  { key: "todas", label: "Todas", test: () => true },
  { key: "em-uso", label: "Em uso", test: (o) => o.health === "active" },
  { key: "atencao", label: "Precisam de atenção", test: (o) => (["cooling", "idle", "never"] as OrganizationHealth[]).includes(o.health) },
  { key: "novas", label: "Novas (30 dias)", test: (o) => Date.now() - new Date(o.createdAt).getTime() < 30 * DAY },
  { key: "suspensas", label: "Suspensas", test: (o) => o.health === "suspended" },
];

const SORTS: Array<{ key: string; label: string; cmp: (a: PlatformOrganizationRow, b: PlatformOrganizationRow) => number }> = [
  { key: "uso", label: "Último uso", cmp: (a, b) => new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime() },
  { key: "vendas", label: "Mais vendas", cmp: (a, b) => Number(b.revenue30d) - Number(a.revenue30d) },
  { key: "custo", label: "Maior custo", cmp: (a, b) => Number(b.usageCost30dUsd) - Number(a.usageCost30dUsd) },
  { key: "novas", label: "Mais novas", cmp: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() },
  { key: "nome", label: "Nome", cmp: (a, b) => a.name.localeCompare(b.name, "pt-BR") },
];

type Search = { filtro?: string; q?: string; nova?: string; ordem?: string; pagina?: string; excluida?: string };

// Só o administrador da plataforma abre esta tela.
export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const [all, rate] = await Promise.all([listPlatformOrganizationRows(db(), actor.userId), platformUsdBrl(db())]);
  const customers = all.filter((o) => o.kind === "customer");
  const internal = all.filter((o) => o.kind === "internal");
  const filter = FILTERS.find((f) => f.key === sp.filtro) ?? FILTERS[0]!;
  const sort = SORTS.find((s) => s.key === sp.ordem) ?? SORTS[0]!;
  const q = (sp.q ?? "").trim().toLowerCase();
  const matched = customers
    .filter(filter.test)
    .filter((o) => !q || [o.name, o.ownerName, o.ownerEmail].some((v) => v?.toLowerCase().includes(q)))
    .sort(sort.cmp);
  const { rows, page, pages } = pageOf(matched, sp.pagina);
  const current = { filtro: filter.key === "todas" ? undefined : filter.key, q: sp.q, ordem: sort.key === "uso" ? undefined : sort.key };
  const href = (change: Record<string, string | undefined>) => hrefWith("/plataforma/empresas", current, { pagina: undefined, ...change });

  return (
    <>
      <div className="page-header">
        <h1>Empresas</h1>
        <p>Todas as empresas clientes do netzsales. Toque numa empresa para ver a ficha completa: uso, pessoas, vendas, mensalidade, custo, liberações e o que ela pediu.</p>
      </div>

      {sp.excluida && <div className="alert success" role="status">Empresa {sp.excluida} excluída de vez.</div>}

      <div className="kpi-grid compact four">
        <div className="kpi"><span className="kpi-label">Em uso</span><span className="kpi-value">{customers.filter((o) => o.health === "active").length}</span><span className="kpi-foot">alguém usou nos últimos 3 dias</span></div>
        <div className="kpi"><span className="kpi-label">Esfriando</span><span className="kpi-value">{customers.filter((o) => o.health === "cooling").length}</span><span className="kpi-foot">sem uso há 4 a 14 dias</span></div>
        <div className="kpi"><span className="kpi-label">Paradas ou nunca usaram</span><span className="kpi-value">{customers.filter((o) => o.health === "idle" || o.health === "never").length}</span><span className="kpi-foot">vale um contato</span></div>
        <div className="kpi"><span className="kpi-label">Pagando</span><span className="kpi-value">{customers.filter((o) => o.status === "active" && (o.billingStatus === "paying" || o.billingStatus === "overdue")).length}</span><span className="kpi-foot">de {customers.length} empresas</span></div>
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
              <Link key={f.key} href={href({ filtro: f.key === "todas" ? undefined : f.key })} className={f.key === filter.key ? "active" : ""}>
                {f.label} <span>{customers.filter(f.test).length}</span>
              </Link>
            ))}
          </nav>
          <form method="get" className="org-search">
            {current.filtro && <input type="hidden" name="filtro" value={current.filtro} />}
            {current.ordem && <input type="hidden" name="ordem" value={current.ordem} />}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar empresa, dono ou e-mail" aria-label="Buscar" />
          </form>
        </div>
        <nav className="sort-links" aria-label="Ordenar">
          <span className="muted">Ordenar por:</span>
          {SORTS.map((s) => (
            <Link key={s.key} href={href({ ordem: s.key === "uso" ? undefined : s.key })} className={s.key === sort.key ? "active" : ""}>{s.label}</Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p className="chart-empty">{customers.length === 0 ? "Nenhuma empresa cliente ainda. Elas chegam pelos pedidos de cadastro ou pelo botão Nova empresa." : "Nenhuma empresa aqui."}</p>
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
                  <th>Mensalidade</th>
                  <th>Custo (30 dias)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/plataforma/empresas/${o.id}`} className="org-link">{o.name}</Link>
                      <div className="muted">{o.ownerName ? `${o.ownerName} · ${o.ownerEmail}` : "sem dono"}</div>
                    </td>
                    <td><span className={`tag ${HEALTH_TONE[o.health]}`}>{HEALTH_LABELS[o.health]}</span></td>
                    <td>{sinceLabel(o.lastActivityAt)}</td>
                    <td>{o.usersActive7d} de {o.usersTotal} <span className="muted">na semana</span></td>
                    <td>{o.sales30d} <span className="muted">· {money(o.revenue30d)}</span></td>
                    <td>{Number(o.monthlyPrice) > 0 ? money(o.monthlyPrice) : <span className="muted">—</span>} <div className="muted">{BILLING_LABELS[o.billingStatus]}</div></td>
                    <td>{Number(o.usageCost30dUsd) > 0 ? money(Number(o.usageCost30dUsd) * rate) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} total={matched.length} href={(p) => hrefWith("/plataforma/empresas", current, { pagina: String(p) })} />
      </section>

      {internal.length > 0 && (
        <details className="card">
          <summary>Empresas internas da equipe ({internal.length}) <span className="edit-hint">Abrir ›</span></summary>
          <p className="muted">
            Empresas da própria equipe netzsales (a sua casa, testes). Ficam fora das listas, dos números e dos usuários. Para mudar, abra a
            empresa e use Administração › Tipo de empresa.
          </p>
          <ul className="org-improvements">
            {internal.map((o) => (
              <li key={o.id}>
                <Link href={`/plataforma/empresas/${o.id}`}>{o.name}</Link>
                <span className="tag">Interna</span>
                <span className="muted">criada em {new Date(o.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {o.salesTotal} vendas</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
