import Link from "next/link";
import { addressLine, can, INSTALLMENT_STATUS_LABELS, listBranches, listCustomers, listReceivables } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { documentLabel, money } from "@/lib/format";
import { CustomerForm } from "./customer-form";
import { Notice, RemoveRecord } from "@/components/remove-record";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; novo?: string; inativos?: string; aviso?: string; filial?: string }> }) {
  const actor = await requirePermission("customers.view");
  const params = await searchParams;
  const includeInactive = params.inativos === "1";
  // Filial só aparece quando a empresa tem mais de uma.
  const branches = can(actor, "branches.view") ? await query(listBranches, {}) : [];
  const multi = branches.length > 1;
  const branch = multi ? branches.find((b) => b.id === params.filial) : undefined;
  const customers = await query(listCustomers, { search: params.q || undefined, includeInactive: true, branchId: branch?.id });
  const shown = includeInactive ? customers : customers.filter((c) => c.status === "active");
  const selected = params.id ? customers.find((c) => c.id === params.id) : undefined;
  const canManage = can(actor, "customers.manage");

  if (selected) {
    const owes = can(actor, "sales.view") ? await query(listReceivables, { customerId: selected.id }) : null;
    return (
      <>
        <p><Link href="/clientes">← Clientes</Link></p>
        <div className="page-header with-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {selected.photoId && <img className="avatar-photo big" src={`/clientes/foto/${selected.photoId}`} alt="" />}
          <div>
            <h1>{selected.name}</h1>
            <p><span className={`tag ${selected.status === "active" ? "ok" : "off"}`}>{selected.status === "active" ? "Ativo" : "Inativo"}</span></p>
          </div>
        </div>
        {owes && owes.total.count > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>Deve {money(owes.total.amount)}</h2>
              <Link href={`/financeiro/receber?cliente=${selected.id}`}>Ver e receber →</Link>
            </div>
            {Number(owes.late.amount) > 0 && <p className="warn-text">{money(owes.late.amount)} já vencido.</p>}
            <ul className="pay-list">
              {owes.items.slice(0, 6).map((i) => (
                <li key={i.installmentId ?? i.saleId}>
                  <span>
                    <Link href={`/vendas?id=${i.saleId}`}>Venda nº {i.saleNumber}</Link>
                    {i.number !== null && <small className="muted"> · parcela {i.number}/{i.count}</small>}
                  </span>
                  <span className="muted">
                    {i.dueDate ? i.dueDate.split("-").reverse().join("/") : "sem data"} · <span className={`tag inst-tag ${i.status}`}>{INSTALLMENT_STATUS_LABELS[i.status]}</span>
                  </span>
                  <strong>{money(i.open)}</strong>
                </li>
              ))}
            </ul>
            {owes.items.length > 6 && <p className="muted">E mais {owes.items.length - 6}.</p>}
          </section>
        )}
        <section className="card">
          <h2>Dados do cliente</h2>
          {canManage ? <CustomerForm key={selected.id} customer={selected} branches={branches} /> : (
            <p className="muted">{[selected.code && `Código ${selected.code}`, documentLabel(selected.document), selected.phone, addressLine(selected), selected.branchName].filter(Boolean).join(" · ") || "Sem outros dados."}</p>
          )}
        </section>
        {canManage && (
          <section className="card">
            <h2>Excluir cliente</h2>
            <p className="muted">Sem vendas, o cliente é apagado. Com vendas, ele é desativado e some das listas.</p>
            <RemoveRecord kind="customer" id={selected.id} name={selected.name} back="/clientes" />
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Clientes</h1>
        <p>Pessoas e empresas para quem você vende. Toque em um cliente para ver e editar.</p>
      </div>
      <Notice text={params.aviso} />

      {canManage && params.novo === "1" && (
        <section className="card">
          <h2>Novo cliente</h2>
          <CustomerForm branches={branches} />
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar por nome, CPF/CNPJ ou e-mail" aria-label="Buscar clientes" />
            {includeInactive && <input type="hidden" name="inativos" value="1" />}
            {multi && (
              <select name="filial" defaultValue={branch?.id ?? ""} aria-label="Filial">
                <option value="">Todas as filiais</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button type="submit" className="secondary">Buscar</button>
          </form>
          {canManage && <Link className="button" href="/clientes?novo=1">Novo cliente</Link>}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{params.q ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>Cidade</th>{multi && <th>Filial</th>}<th>Situação</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="clickable">
                    <td>
                      <div className="with-thumb">
                        {c.photoId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="avatar-photo" src={`/clientes/foto/${c.photoId}`} alt="" loading="lazy" />
                        ) : (
                          <span className="thumb empty round">{c.name[0]}</span>
                        )}
                        <Link href={`/clientes?id=${c.id}`}>{c.name}</Link>
                      </div>
                    </td>
                    <td data-label="CPF/CNPJ" className="sm-hide">{documentLabel(c.document)}</td>
                    <td data-label="Telefone">{c.phone}</td>
                    <td data-label="Cidade" className="sm-hide">{[c.city, c.state].filter(Boolean).join(" / ")}</td>
                    {multi && <td data-label="Filial">{c.branchName ?? <span className="muted">Todas</span>}</td>}
                    <td data-label="Situação"><span className={`tag ${c.status === "active" ? "ok" : "off"}`}>{c.status === "active" ? "Ativo" : "Inativo"}</span></td>
                    <td><Link className="button secondary small" href={`/clientes?id=${c.id}`}>{canManage ? "Editar" : "Abrir"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          {canManage && <><Link href="/primeiros-passos/clientes">Trazer clientes de uma planilha</Link> · </>}
          {includeInactive ? <Link href="/clientes">Esconder inativos</Link> : <Link href="/clientes?inativos=1">Mostrar inativos</Link>}
        </p>
      </section>
    </>
  );
}
