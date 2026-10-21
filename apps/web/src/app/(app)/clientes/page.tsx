import Link from "next/link";
import { can, listCustomers } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { documentLabel } from "@/lib/format";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; novo?: string; inativos?: string }> }) {
  const actor = await requirePermission("customers.view");
  const params = await searchParams;
  const includeInactive = params.inativos === "1";
  const customers = await query(listCustomers, { search: params.q || undefined, includeInactive: true });
  const shown = includeInactive ? customers : customers.filter((c) => c.status === "active");
  const selected = params.id ? customers.find((c) => c.id === params.id) : undefined;
  const canManage = can(actor, "customers.manage");

  return (
    <>
      <div className="page-header">
        <h1>Clientes</h1>
        <p>Pessoas e empresas para quem você vende.</p>
      </div>

      {canManage && params.novo === "1" && (
        <section className="card">
          <h2>Novo cliente</h2>
          <CustomerForm />
        </section>
      )}
      {selected && canManage && (
        <section className="card">
          <h2>{selected.name}</h2>
          <CustomerForm key={selected.id} customer={selected} />
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar por nome, CPF/CNPJ ou e-mail" aria-label="Buscar clientes" />
            {includeInactive && <input type="hidden" name="inativos" value="1" />}
            <button type="submit" className="secondary">Buscar</button>
          </form>
          {canManage && <Link className="button" href="/clientes?novo=1">Novo cliente</Link>}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{params.q ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>Cidade</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="clickable">
                    <td><Link href={`/clientes?id=${c.id}`}>{c.name}</Link></td>
                    <td>{documentLabel(c.document)}</td>
                    <td>{c.phone}</td>
                    <td>{[c.city, c.state].filter(Boolean).join(" / ")}</td>
                    <td><span className={`tag ${c.status === "active" ? "ok" : "off"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          {includeInactive ? <Link href="/clientes">Esconder inativos</Link> : <Link href="/clientes?inativos=1">Mostrar inativos</Link>}
        </p>
      </section>
    </>
  );
}
