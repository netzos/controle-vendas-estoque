import { listPlatformOrganizations } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { CreateOrganizationForm, OrganizationStatus, OwnerLink } from "./forms";

export const metadata = { title: "Empresas" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

// Só o administrador da plataforma abre esta tela.
export default async function OrganizationsPage() {
  const actor = await requireDeveloper();
  const organizations = await listPlatformOrganizations(db(), actor.userId);

  return (
    <>
      <div className="page-header">
        <h1>Empresas</h1>
        <p>Todas as empresas que usam o netzsales. Crie uma empresa direto aqui (sem passar pelo pedido de cadastro) e mande ao dono o link para criar a senha.</p>
      </div>
      <section className="card">
        <h2>Nova empresa</h2>
        <CreateOrganizationForm />
      </section>
      {organizations.map((o) => (
        <details className="card" key={o.id}>
          <summary>
            {o.name} <span className="muted">{o.ownerName ? `${o.ownerName} · ${o.ownerEmail}` : "sem dono"}</span>{" "}
            {o.ownerName && (
              <span className={`tag ${o.ownerLastLoginAt ? "ok" : "off"}`}>{o.ownerLastLoginAt ? "Dono já entrou" : "Dono ainda não entrou"}</span>
            )}{" "}
            {o.status === "suspended" && <span className="tag warn">Suspensa</span>}{" "}
            {o.developerIsMember && <span className="tag">Você participa</span>} <span className="edit-hint">Abrir ›</span>
          </summary>
          <p className="muted">
            Criada em {fmt.format(new Date(o.createdAt))} · {o.members} {o.members === 1 ? "usuário" : "usuários"} · {o.sales}{" "}
            {o.sales === 1 ? "venda" : "vendas"}
            {o.lastSaleAt ? ` · última venda em ${fmt.format(new Date(o.lastSaleAt))}` : ""}
          </p>
          {o.ownerMembershipId && <OwnerLink organizationId={o.id} firstAccess={!o.ownerLastLoginAt} />}
          <OrganizationStatus organizationId={o.id} name={o.name} status={o.status} />
        </details>
      ))}
    </>
  );
}
