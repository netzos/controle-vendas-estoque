import Link from "next/link";
import { can, getOrganization, listAuditLogs } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { query } from "@/lib/actions";
import { CURRENT_PHASE } from "@/lib/navigation";
import { AuditTable } from "./administracao/auditoria/audit-table";

export const metadata = { title: "Início" };

export default async function HomePage() {
  const actor = await currentActor();
  const org = await query(getOrganization, {});
  const recent = can(actor, "audit.view") ? await query(listAuditLogs, { limit: 10 }) : null;

  return (
    <>
      <div className="page-header">
        <h1>{org.name}</h1>
        <p>Olá, {actor.userName}.</p>
      </div>

      <section className="card">
        <h2>Estado do sistema</h2>
        <p>
          Fase {CURRENT_PHASE} (Fundação) concluída: acesso, empresas, filiais, usuários, perfis de permissão,
          configurações e auditoria. Os módulos de cadastros, vendas, estoque, financeiro, assistente de IA e
          automações aparecem no menu com a fase em que serão liberados.
        </p>
        <p className="muted">Os indicadores do dashboard serão exibidos quando houver vendas e estoque registrados; nenhum número fictício é mostrado.</p>
      </section>

      {recent && (
        <section className="card">
          <h2>Atividades recentes</h2>
          {recent.items.length === 0 ? <p className="muted">Nenhuma atividade registrada.</p> : <AuditTable items={recent.items} timeZone={org.timezone} />}
          <div className="actions">
            <Link href="/administracao/auditoria">Ver auditoria completa</Link>
          </div>
        </section>
      )}
    </>
  );
}
