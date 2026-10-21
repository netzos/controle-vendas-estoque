import Link from "next/link";
import { can, getOrganization, listAuditLogs, listCustomers, listProducts, listSuppliers } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { query } from "@/lib/actions";
import { AuditTable } from "./administracao/auditoria/audit-table";

export const metadata = { title: "Início" };

export default async function HomePage() {
  const actor = await currentActor();
  const org = await query(getOrganization, {});
  const recent = can(actor, "audit.view") ? await query(listAuditLogs, { limit: 10 }) : null;
  const [customers, products, suppliers] = await Promise.all([
    can(actor, "customers.view") ? query(listCustomers, { limit: 500 }) : null,
    can(actor, "products.view") ? query(listProducts, { limit: 500 }) : null,
    can(actor, "suppliers.view") ? query(listSuppliers, { limit: 500 }) : null,
  ]);
  const shortcuts = [
    customers && { href: "/clientes", label: "Clientes ativos", count: customers.length, action: "Cadastrar cliente" },
    products && { href: "/produtos", label: "Produtos ativos", count: products.length, action: "Cadastrar produto" },
    suppliers && { href: "/fornecedores", label: "Fornecedores ativos", count: suppliers.length, action: "Cadastrar fornecedor" },
  ].filter((q): q is { href: string; label: string; count: number; action: string } => Boolean(q));

  return (
    <>
      <div className="page-header">
        <h1>{org.name}</h1>
        <p>Olá, {actor.userName}.</p>
      </div>

      <div className="quick-grid">
        {shortcuts.map((q) => (
          <Link key={q.href} href={q.href} className="card quick-card">
            <span className="quick-count">{q.count}</span>
            <span className="quick-label">{q.label}</span>
            <span className="quick-action">{q.action}</span>
          </Link>
        ))}
      </div>

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
