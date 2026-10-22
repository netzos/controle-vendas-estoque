import { listPlatformUsers } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Usuários da plataforma" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const DAY = 24 * 60 * 60 * 1000;

function activity(last: Date | null): { label: string; cls: string } {
  if (!last) return { label: "Nunca entrou", cls: "off" };
  const days = (Date.now() - new Date(last).getTime()) / DAY;
  if (days < 1) return { label: "Ativo hoje", cls: "ok" };
  if (days < 7) return { label: "Ativo na semana", cls: "ok" };
  if (days < 30) return { label: "Ativo no mês", cls: "run" };
  return { label: "Parado", cls: "warn" };
}

export default async function PlatformUsersPage() {
  const actor = await requireDeveloper();
  const users = await listPlatformUsers(db(), actor.userId);
  return (
    <>
      <div className="page-header">
        <h1>Usuários</h1>
        <p>Todas as pessoas com conta no netzsales, da mais recente a entrar para a menos recente.</p>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pessoa</th><th>Empresas</th><th>Último acesso</th><th>Netz (30 dias)</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const a = activity(u.lastLoginAt);
                return (
                  <tr key={u.id}>
                    <td>
                      {u.name} <span className="muted">{u.email}</span>
                      {u.isDeveloper && <span className="tag">Administrador</span>}
                      {u.status !== "active" && <span className="tag off">Desativado</span>}
                    </td>
                    <td>{u.organizations.length ? u.organizations.join(", ") : <span className="muted">nenhuma</span>}</td>
                    <td>
                      <span className={`tag ${a.cls}`}>{a.label}</span>{" "}
                      <span className="muted">{u.lastLoginAt ? fmt.format(new Date(u.lastLoginAt)) : ""}</span>
                    </td>
                    <td>{u.netzMessages30d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
