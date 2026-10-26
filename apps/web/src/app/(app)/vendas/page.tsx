import Link from "next/link";
import { can, enabledFeatures, FULFILLMENTS, PAYMENT_STATUS_LABELS, getOrganization, getSale, getSaleFollowup, listSales, listStepTypes, orgDate, PAYMENT_LABELS } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { money, quantity } from "@/lib/format";
import { CancelSaleForm } from "./cancel-form";
import { ReceivePaymentForm } from "./receive-form";
import { AddStepsForm, StepRow } from "../entregas/steps";

export const metadata = { title: "Vendas" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; receber?: string }> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const [org, sales, selected, features] = await Promise.all([
    query(getOrganization, {}),
    query(listSales, { search: params.q || undefined, openPayment: params.receber === "1" }),
    params.id ? query(getSale, { id: params.id }).catch(() => null) : null,
    enabledFeatures(db(), actor.organizationId),
  ]);
  const seesSteps = features.has("deliveries") && can(actor, "deliveries.view");
  const [followup, today, stepTypes] = selected && seesSteps
    ? await Promise.all([query(getSaleFollowup, { saleId: selected.id }), query(orgDate, {}), query(listStepTypes, {})])
    : [null, "", []];
  const canSteps = can(actor, "deliveries.manage");
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
            <span>
              {selected.status === "completed" && selected.paymentStatus !== "paid" && (
                <span className={`tag pay-tag ${selected.paymentStatus}`}>{PAYMENT_STATUS_LABELS[selected.paymentStatus]}</span>
              )}{" "}
              <span className={`tag ${selected.status === "completed" ? "ok" : "off"}`}>{selected.status === "completed" ? "Concluída" : "Cancelada"}</span>
            </span>
          </div>
          <p className="muted">
            {fmt.format(selected.soldAt)} · {FULFILLMENTS[selected.fulfillment]} · {selected.customerName ?? "Consumidor"} · por {selected.userName}
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produto</th><th className="num">Qtd.</th><th className="num">Preço</th><th className="num">Total</th></tr></thead>
              <tbody>
                {selected.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.productName}
                      {Number(i.backorderQty) > 0 && <small className="muted">{quantity(i.backorderQty)} por encomenda</small>}
                    </td>
                    <td className="num">{quantity(i.quantity)} {i.unitCode}</td>
                    <td className="num">{money(i.unitPrice)}</td>
                    <td className="num">{money(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.tradeIns.length > 0 && (
            <>
              <h3 className="form-section">Recebido na troca</h3>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {selected.tradeIns.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/estoque/movimentacoes?produto=${t.productId}`}>{t.productName}</Link>{t.notes && <small className="muted">{t.notes}</small>}</td>
                        <td className="num">{quantity(t.quantity)} {t.unitCode}</td>
                        <td className="num">−{money(t.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="cart-sum">
            <span>
              Subtotal {money(selected.subtotal)}
              {Number(selected.discount) > 0 && ` · desconto ${money(selected.discount)}`}
              {Number(selected.deliveryFee) > 0 && ` · frete ${money(selected.deliveryFee)}`}
              {Number(selected.tradeInTotal) > 0 && ` · troca ${money(selected.tradeInTotal)}`}
            </span>
            <span className="cart-grand">{money(selected.total)}</span>
          </div>
          <h3 className="form-section">Pagamento</h3>
          {selected.payments.length === 0 ? (
            <p className="muted">Nada recebido ainda.</p>
          ) : (
            <ul className="pay-list">
              {selected.payments.map((p) => (
                <li key={p.id}>
                  <span>{PAYMENT_LABELS[p.method]}{p.notes ? <small className="muted"> · {p.notes}</small> : null}</span>
                  <span className="muted">{fmt.format(p.paidAt)} · {p.userName.split(" ")[0]}</span>
                  <strong>{money(p.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
          {(() => {
            const open = Number(selected.total) - Number(selected.tradeInTotal) - Number(selected.paidTotal);
            if (selected.status !== "completed" || open <= 0.004) return null;
            return (
              <div className="open-box">
                <p><b>Falta receber {money(open)}</b> de {money(Number(selected.total) - Number(selected.tradeInTotal))}.</p>
                {can(actor, "sales.receive") && <ReceivePaymentForm saleId={selected.id} open={open.toFixed(2)} />}
              </div>
            );
          })()}
          {followup && (
            <>
              <h3 className="form-section">Depois da venda</h3>
              {(followup.address || followup.recipient || followup.phone) && (
                <p className="muted">{[followup.address, followup.recipient, followup.phone].filter(Boolean).join(" · ")}</p>
              )}
              <ul className="step-list">
                {followup.steps.map((s) => <StepRow key={s.id} step={s} today={today} canManage={canSteps} showSale={false} />)}
              </ul>
            </>
          )}
          {selected.status === "completed" && canSteps && <AddStepsForm saleId={selected.id} hasFollowup={!!followup} today={today} stepNames={stepTypes.map((t) => t.name)} />}
          {selected.status === "cancelled" && <p className="muted">Cancelada: {selected.cancelReason}</p>}
          {selected.status === "completed" && can(actor, "sales.cancel") && <CancelSaleForm id={selected.id} />}
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar pelo número ou pelo cliente" aria-label="Buscar vendas" />
            {params.receber === "1" && <input type="hidden" name="receber" value="1" />}
            <button type="submit" className="secondary">Buscar</button>
          </form>
          <nav className="segmented" aria-label="Filtro de pagamento">
            <Link href="/vendas" className={params.receber === "1" ? "" : "active"}>Todas</Link>
            <Link href="/vendas?receber=1" className={params.receber === "1" ? "active" : ""}>Falta receber</Link>
          </nav>
          {can(actor, "sales.create") && <Link className="button" href="/vendas/nova">+ Nova venda</Link>}
        </div>
        {sales.length === 0 ? (
          <p className="muted">{params.receber === "1" ? "Nenhuma venda com pagamento em aberto." : params.q ? "Nenhuma venda encontrada." : "Nenhuma venda registrada ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th className="num">Itens</th><th className="num">Total</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="clickable">
                    <td data-label="Nº"><Link href={`/vendas?id=${s.id}`}>{s.number}</Link></td>
                    <td data-label="Data">{fmt.format(s.soldAt)}</td>
                    <td data-label="Cliente">{s.customerName ?? <span className="muted">Consumidor</span>}</td>
                    <td data-label="Pagamento">
                      {s.status === "completed" && s.paymentStatus !== "paid" ? (
                        <span className={`tag pay-tag ${s.paymentStatus}`}>
                          {s.paymentStatus === "partial" ? `Parcial · falta ${money(Number(s.total) - Number(s.tradeInTotal) - Number(s.paidTotal))}` : "A receber"}
                        </span>
                      ) : (
                        PAYMENT_LABELS[s.paymentMethod]
                      )}
                    </td>
                    <td data-label="Itens" className="num sm-hide">{s.itemCount}</td>
                    <td data-label="Total" className="num"><strong className={s.status === "cancelled" ? "strike muted" : ""}>{money(s.total)}</strong></td>
                    <td data-label="Situação"><span className={`tag ${s.status === "completed" ? "ok" : "off"}`}>{s.status === "completed" ? "Concluída" : "Cancelada"}</span></td>
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
