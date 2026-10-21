import Link from "next/link";
import { getOrganization, listAuditLogs } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { AuditTable } from "./audit-table";

export const metadata = { title: "Auditoria" };

type Search = { acao?: string; canal?: string; antes?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const channel = ["web", "telegram", "api", "system", "whatsapp"].includes(sp.canal ?? "") ? (sp.canal as "web") : undefined;
  const [org, page] = await Promise.all([
    query(getOrganization, {}),
    query(listAuditLogs, {
      action: sp.acao?.trim() || undefined,
      channel,
      before: sp.antes && /^\d+$/.test(sp.antes) ? Number(sp.antes) : undefined,
      limit: 50,
    }),
  ]);
  const next = new URLSearchParams({ ...(sp.acao ? { acao: sp.acao } : {}), ...(channel ? { canal: channel } : {}), ...(page.nextCursor ? { antes: page.nextCursor } : {}) });

  return (
    <>
      <div className="page-header">
        <h1>Auditoria</h1>
        <p>Registro de todas as alterações feitas pelo painel, Telegram, API e rotinas automáticas.</p>
      </div>
      <form className="card" method="get">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="acao">Operação começa com</label>
            <input id="acao" name="acao" defaultValue={sp.acao ?? ""} placeholder="ex.: member, branch, role" />
          </div>
          <div className="field">
            <label htmlFor="canal">Canal</label>
            <select id="canal" name="canal" defaultValue={channel ?? ""}>
              <option value="">Todos</option>
              <option value="web">Painel</option>
              <option value="telegram">Telegram</option>
              <option value="api">API</option>
              <option value="system">Sistema</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="secondary">Filtrar</button>
          <Link href="/administracao/auditoria">Limpar</Link>
        </div>
      </form>
      <section className="card">
        {page.items.length === 0 ? <p className="muted">Nenhum registro encontrado.</p> : <AuditTable items={page.items} timeZone={org.timezone} />}
        {page.nextCursor && (
          <div className="actions">
            <Link href={`/administracao/auditoria?${next}`}>Registros anteriores</Link>
          </div>
        )}
      </section>
    </>
  );
}
