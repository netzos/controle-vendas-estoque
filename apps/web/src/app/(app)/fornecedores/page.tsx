import Link from "next/link";
import { can, listProducts, listSupplierProducts, listSuppliers } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { documentLabel, whatsappLabel, whatsappLink } from "@/lib/format";
import { SupplierPrices } from "./supplier-prices";
import { SupplierForm } from "./supplier-form";

export const metadata = { title: "Fornecedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; novo?: string; inativos?: string }> }) {
  const actor = await requirePermission("suppliers.view");
  const params = await searchParams;
  const includeInactive = params.inativos === "1";
  const suppliers = await query(listSuppliers, { search: params.q || undefined, includeInactive: true });
  const shown = includeInactive ? suppliers : suppliers.filter((c) => c.status === "active");
  const selected = params.id ? suppliers.find((c) => c.id === params.id) : undefined;
  const canManage = can(actor, "suppliers.manage");
  const [prices, products] = selected
    ? await Promise.all([
        query(listSupplierProducts, { supplierId: selected.id }),
        canManage && can(actor, "products.view") ? query(listProducts, { limit: 500 }) : Promise.resolve([]),
      ])
    : [[], []];

  return (
    <>
      <div className="page-header">
        <h1>Fornecedores</h1>
        <p>De quem você compra mercadorias e insumos.</p>
      </div>

      {canManage && params.novo === "1" && (
        <section className="card">
          <h2>Novo fornecedor</h2>
          <SupplierForm />
        </section>
      )}
      {selected && canManage && (
        <section className="card">
          <h2>{selected.name}</h2>
          <SupplierForm key={selected.id} supplier={selected} />
        </section>
      )}
      {selected && (
        <section className="card">
          <SupplierPrices
            key={selected.id}
            side="supplier"
            ownerId={selected.id}
            rows={prices}
            options={products.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))}
            canManage={canManage}
          />
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar por nome, CPF/CNPJ ou e-mail" aria-label="Buscar fornecedores" />
            {includeInactive && <input type="hidden" name="inativos" value="1" />}
            <button type="submit" className="secondary">Buscar</button>
          </form>
          {canManage && <Link className="button" href="/fornecedores?novo=1">Novo fornecedor</Link>}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{params.q ? "Nenhum fornecedor encontrado." : "Nenhum fornecedor cadastrado ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome</th><th>CPF/CNPJ</th><th>Contato</th><th>WhatsApp</th><th className="num">Prazo</th><th>Cidade</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="clickable">
                    <td><Link href={`/fornecedores?id=${c.id}`}>{c.name}</Link></td>
                    <td>{documentLabel(c.document)}</td>
                    <td>{c.contactName}{c.contactName && c.email ? <small className="muted">{c.email}</small> : !c.contactName ? c.email : null}</td>
                    <td>{c.whatsapp ? <a href={whatsappLink(c.whatsapp)} target="_blank" rel="noreferrer">{whatsappLabel(c.whatsapp)}</a> : c.phone}</td>
                    <td className="num">{c.leadTimeDays == null ? "—" : `${c.leadTimeDays}d`}</td>
                    <td>{[c.city, c.state].filter(Boolean).join(" / ")}</td>
                    <td><span className={`tag ${c.status === "active" ? "ok" : "off"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          {includeInactive ? <Link href="/fornecedores">Esconder inativos</Link> : <Link href="/fornecedores?inativos=1">Mostrar inativos</Link>}
        </p>
      </section>
    </>
  );
}
