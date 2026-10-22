import Link from "next/link";
import { listPlatformUsers, type PlatformUser } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { hrefWith, pageOf, Pager } from "../ui";

export const metadata = { title: "Usuários da plataforma" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const DAY = 24 * 60 * 60 * 1000;

function lastUse(u: PlatformUser): Date | null {
  const a = u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0;
  const b = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;
  return a || b ? new Date(Math.max(a, b)) : null;
}

function activity(last: Date | null): { label: string; cls: string } {
  if (!last) return { label: "Nunca entrou", cls: "off" };
  const days = (Date.now() - last.getTime()) / DAY;
  if (days < 1) return { label: "Ativo hoje", cls: "ok" };
  if (days < 7) return { label: "Ativo na semana", cls: "ok" };
  if (days < 30) return { label: "Ativo no mês", cls: "run" };
  return { label: "Parado", cls: "warn" };
}

const isClient = (u: PlatformUser) => !u.isDeveloper && u.organizations.length > 0;

const TABS: Array<{ key: string; label: string; test: (u: PlatformUser) => boolean }> = [
  { key: "clientes", label: "Clientes", test: isClient },
  { key: "semana", label: "Ativos na semana", test: (u) => isClient(u) && (lastUse(u)?.getTime() ?? 0) > Date.now() - 7 * DAY },
  { key: "nunca", label: "Nunca entraram", test: (u) => isClient(u) && !u.lastLoginAt },
  { key: "equipe", label: "Equipe netzsales", test: (u) => u.isDeveloper },
  { key: "sem-empresa", label: "Sem empresa", test: (u) => !u.isDeveloper && u.organizations.length === 0 },
];

type Search = { aba?: string; q?: string; pagina?: string };

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const users = await listPlatformUsers(db(), actor.userId);
  const tab = TABS.find((t) => t.key === sp.aba) ?? TABS[0]!;
  const q = (sp.q ?? "").trim().toLowerCase();
  const matched = users.filter(tab.test).filter((u) => !q || [u.name, u.email, ...u.organizations].some((v) => v.toLowerCase().includes(q)));
  const { rows, page, pages } = pageOf(matched, sp.pagina);
  const current = { aba: tab.key === "clientes" ? undefined : tab.key, q: sp.q };

  return (
    <>
      <div className="page-header">
        <h1>Usuários</h1>
        <p>As pessoas das empresas clientes, da que usou por último para a que usou há mais tempo. A equipe netzsales fica numa aba separada.</p>
      </div>
      <section className="card">
        <div className="imp-toolbar">
          <nav className="imp-tabs" aria-label="Grupo">
            {TABS.map((t) => (
              <Link key={t.key} href={hrefWith("/plataforma/usuarios", current, { aba: t.key === "clientes" ? undefined : t.key, pagina: undefined })} className={t.key === tab.key ? "active" : ""}>
                {t.label} <span>{users.filter(t.test).length}</span>
              </Link>
            ))}
          </nav>
          <form method="get" className="org-search">
            {current.aba && <input type="hidden" name="aba" value={current.aba} />}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar nome, e-mail ou empresa" aria-label="Buscar" />
          </form>
        </div>
        {rows.length === 0 ? (
          <p className="chart-empty">Ninguém aqui.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pessoa</th><th>{tab.key === "equipe" ? "Empresas da equipe" : "Empresas"}</th><th>Último uso</th><th>Netz (30 dias)</th></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const last = lastUse(u);
                  const a = activity(last);
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.name} <span className="muted">{u.email}</span>
                        {u.isDeveloper && <span className="tag">Administrador</span>}
                        {u.status !== "active" && <span className="tag off">Desativado</span>}
                      </td>
                      <td>
                        {tab.key === "equipe" ? (
                          <span className="muted">{u.internalOrganizations.join(", ") || "nenhuma"}{u.organizations.length ? ` · suporte em ${u.organizations.length} cliente(s)` : ""}</span>
                        ) : u.organizations.length ? (
                          u.organizations.map((name, i) => (
                            <span key={u.organizationIds[i] ?? name}>
                              {i > 0 && ", "}
                              <Link href={`/plataforma/empresas/${u.organizationIds[i]}`}>{name}</Link>
                            </span>
                          ))
                        ) : (
                          <span className="muted">nenhuma</span>
                        )}
                      </td>
                      <td>
                        <span className={`tag ${a.cls}`}>{a.label}</span>{" "}
                        <span className="muted">{last ? fmt.format(last) : ""}</span>
                      </td>
                      <td>{u.netzMessages30d}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} total={matched.length} href={(p) => hrefWith("/plataforma/usuarios", current, { pagina: String(p) })} />
      </section>
    </>
  );
}
