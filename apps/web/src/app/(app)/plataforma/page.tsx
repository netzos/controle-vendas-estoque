import Link from "next/link";
import { platformOverview } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

export const metadata = { title: "Plataforma" };

export default async function PlatformPage() {
  const actor = await requireDeveloper();
  const o = await platformOverview(db(), actor.userId);
  return (
    <>
      <div className="page-header">
        <h1>Plataforma</h1>
        <p>Como está o netzsales como um todo: pedidos de cadastro, empresas e quem está usando.</p>
      </div>
      <div className="kpi-grid">
        <Link href="/plataforma/pedidos" className={`kpi link ${o.pendingRequests ? "hero" : ""}`}>
          <span className="kpi-label">Pedidos de cadastro esperando</span>
          <span className="kpi-value">{o.pendingRequests}</span>
          <span className="kpi-foot">{o.pendingRequests ? "Toque para aprovar ou recusar" : "Nenhum esperando"}</span>
        </Link>
        <Link href="/plataforma/empresas" className="kpi link">
          <span className="kpi-label">Empresas ativas</span>
          <span className="kpi-value">{o.organizations}</span>
          <span className="kpi-foot">{o.organizationsSuspended ? `${o.organizationsSuspended} suspensa(s)` : "Nenhuma suspensa"}</span>
        </Link>
        <Link href="/plataforma/usuarios" className="kpi link">
          <span className="kpi-label">Usuários ativos na semana</span>
          <span className="kpi-value">{o.users7d}</span>
          <span className="kpi-foot">{o.usersToday} hoje · {o.users30d} no mês</span>
        </Link>
        <Link href="/plataforma/usuarios" className="kpi link">
          <span className="kpi-label">Contas que nunca entraram</span>
          <span className="kpi-value">{o.usersNever}</span>
          <span className="kpi-foot">de {o.usersTotal} contas</span>
        </Link>
      </div>
      <div className="kpi-grid compact">
        <div className="kpi">
          <span className="kpi-label">Vendas registradas (30 dias)</span>
          <span className="kpi-value">{o.sales30d}</span>
          <span className="kpi-foot">todas as empresas, inclusive a de demonstração</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Valor vendido (30 dias)</span>
          <span className="kpi-value">{money(o.revenue30d)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Mensagens para a Netz (30 dias)</span>
          <span className="kpi-value">{o.netzMessages30d}</span>
          <span className="kpi-foot">painel e Telegram</span>
        </div>
      </div>
    </>
  );
}
