import Link from "next/link";
import { can, getOrganization, getSale, listSales, PAYMENT_LABELS } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { CancelSaleForm } from "./cancel-form";

export const metadata = { title: "Vendas" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string }> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const [org, sales, selected] = await Promise.all([
    query(getOrganization, {}),
    query(listSales, { search: params.q || undefined }),
    params.id ? query(getSale, { id: params.id }).catch(() => null) : null,
  ]);
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <div className="page-header">
        <h1>Vendas</h1>
        <p>Todas as vendas registradas. Cancelar uma venda devolve os itens ao estoque.</p>
      </div>

      {selected && (
        <section className="card">
          <div className="card-head">
            <h2>Venda nº {selected.number}</h2>
            <span className={`tag ${selected.status === "completed" ? "ok" : "off"}`}>{selected.status === "completed" ? "Concluída" : "Cancelada"}</span>
          </div>
          <p className="muted">
            {fmt.format(selected.soldAt)} · {PAYMENT_LABELS[selected.paymentMethod]} · {selected.customerName ?? "Consumidor"} · por {selected.userName}
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produto</th><th className="num">Qtd.</th><th className="num">Preço</th><th className="num">Total</th></tr></thead>
              <tbody>
                {selected.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.productName}</td>
                    <td className="num">{quantity(i.quantity)} {i.unitCode}</td>
                    <td className="num">{money(i.unitPrice)}</td>
                    <td className="num">{money(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cart-sum">
            <span>Subtotal {money(selected.subtotal)}{Number(selected.discount) > 0 && ` · desconto ${money(selected.discount)}`}</span>
            <span className="cart-grand">{money(selected.total)}</span>
          </div>
          {selected.status === "cancelled" && <p className="muted">Cancelada: {selected.cancelReason}</p>}
          {selected.status === "completed" && can(actor, "sales.cancel") && <CancelSaleForm id={selected.id} />}
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar pelo número ou pelo cliente" aria-label="Buscar vendas" />
            <button type="submit" className="secondary">Buscar</button>
          </form>
          {can(actor, "sales.create") && <Link className="button" href="/vendas/nova">+ Nova venda</Link>}
        </div>
        {sales.length === 0 ? (
          <p className="muted">{params.q ? "Nenhuma venda encontrada." : "Nenhuma venda registrada ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th className="num">Itens</th><th className="num">Total</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="clickable">
                    <td><Link href={`/vendas?id=${s.id}`}>{s.number}</Link></td>
                    <td>{fmt.format(s.soldAt)}</td>
                    <td>{s.customerName ?? <span className="muted">Consumidor</span>}</td>
                    <td>{PAYMENT_LABELS[s.paymentMethod]}</td>
                    <td className="num">{s.itemCount}</td>
                    <td className="num"><strong className={s.status === "cancelled" ? "strike muted" : ""}>{money(s.total)}</strong></td>
                    <td><span className={`tag ${s.status === "completed" ? "ok" : "off"}`}>{s.status === "completed" ? "Concluída" : "Cancelada"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
