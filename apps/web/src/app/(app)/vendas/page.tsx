import Link from "next/link";
import { can, enabledFeatures, listProducts, FULFILLMENTS, PAYMENT_STATUS_LABELS, getOrganization, getSale, getSaleFollowup, listBranches, listSales, listStepTypes, orgDate, PAYMENT_LABELS, PAYMENT_LATER_LABEL, handoverDateReady, isPaymentLater } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { money, quantity } from "@/lib/format";
import { CancelSaleForm, DeleteSaleForm } from "./cancel-form";
import { Notice } from "@/components/remove-record";
import { ReceivePaymentForm } from "./receive-form";
import { HandoverDateForm } from "./handover-form";
import { EditSaleForm } from "./edit-form";
import { AddStepsForm, StepRow } from "../entregas/steps";

export const metadata = { title: "Vendas" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; receber?: string; filial?: string; aviso?: string }> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const branches = can(actor, "branches.view") ? await query(listBranches, {}) : [];
  const multi = branches.length > 1;
  const branch = multi ? branches.find((b) => b.id === params.filial) : undefined;
  const [org, sales, selected, features, handoverReady] = await Promise.all([
    query(getOrganization, {}),
    query(listSales, { search: params.q || undefined, openPayment: params.receber === "1", branchId: branch?.id }),
    params.id ? query(getSale, { id: params.id }).catch(() => null) : null,
    enabledFeatures(db(), actor.organizationId),
    handoverDateReady(db()),
  ]);
  const seesSteps = features.has("deliveries") && can(actor, "deliveries.view");
  const [followup, today, stepTypes] = selected && seesSteps
    ? await Promise.all([query(getSaleFollowup, { saleId: selected.id }), query(orgDate, {}), query(listStepTypes, {})])
    : [null, "", []];
  const canSteps = can(actor, "deliveries.manage");
  // Corrigir itens: venda concluída e ainda não paga por inteiro (melhoria 17).
  const canEdit = !!selected && selected.status === "completed" && can(actor, "sales.create") && !actor.platformView &&
    !(selected.paymentStatus === "paid" && Number(selected.paidTotal) > 0);
  const editProducts = canEdit ? await query(listProducts, { limit: 500 }) : [];
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  // "2026-11-02" → "02/11"; o ano só aparece quando não é o atual.
  const year = String(new Date().getFullYear());
  const day = (d: string) => { const [y, m, dd] = d.split("-"); return y === year ? `${dd}/${m}` : `${dd}/${m}/${y}`; };
  const handoverWord = (f: string) => (f === "delivery" ? "Entrega" : "Retirada");

  return (
    <>
      <div className="page-header">
        <h1>Vendas</h1>
        <p>Todas as vendas registradas. Cancelar uma venda devolve os itens ao estoque e guarda o histórico; excluir apaga a venda de vez.</p>
      </div>
      <Notice text={params.aviso} />

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
            {fmt.format(selected.soldAt)} · {FULFILLMENTS[selected.fulfillment]}
            {selected.handoverDate && <> em <b>{day(selected.handoverDate)}</b></>} · {selected.customerName ?? "Consumidor"} · por {selected.userName}
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
          {canEdit && (
            <EditSaleForm
              key={`${selected.id}-${selected.total}`}
              saleId={selected.id}
              canChangePrice={can(actor, "sales.change_price")}
              items={[...selected.items.reduce((m, i) => {
                const prev = m.get(i.productId);
                m.set(i.productId, { productId: i.productId, name: i.productName, quantity: String(Number(i.quantity) + Number(prev?.quantity ?? 0)), unitPrice: String(Number(i.unitPrice)) });
                return m;
              }, new Map<string, { productId: string; name: string; quantity: string; unitPrice: string }>()).values()]}
              products={editProducts.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name, price: String(Number(p.salePrice)) }))}
            />
          )}
          {handoverReady && selected.status === "completed" && can(actor, "sales.create") && (
            <HandoverDateForm
              saleId={selected.id}
              value={selected.handoverDate}
              label={selected.fulfillment === "delivery" ? "Data da entrega" : "Data da retirada"}
            />
          )}
          <h3 className="form-section">Pagamento</h3>
          {selected.payments.length === 0 ? (
            <p className="muted">{isPaymentLater(selected) ? "Forma de pagamento a combinar. Nada recebido ainda." : "Nada recebido ainda."}</p>
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
          {can(actor, "sales.cancel") && <DeleteSaleForm id={selected.id} number={selected.number} />}
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar pelo número ou pelo cliente" aria-label="Buscar vendas" />
            {params.receber === "1" && <input type="hidden" name="receber" value="1" />}
            {multi && (
              <select name="filial" defaultValue={branch?.id ?? ""} aria-label="Filial">
                <option value="">Todas as filiais</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
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
                <tr><th>Nº</th><th>Data</th><th>Cliente</th>{multi && <th>Filial</th>}<th>Pagamento</th>{handoverReady && <th>Retirada</th>}<th className="num">Itens</th><th className="num">Total</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="clickable">
                    <td data-label="Nº"><Link href={`/vendas?id=${s.id}`}>{s.number}</Link></td>
                    <td data-label="Data">{fmt.format(s.soldAt)}</td>
                    <td data-label="Cliente">{s.customerName ?? <span className="muted">Consumidor</span>}</td>
                    {multi && <td data-label="Filial">{s.branchName ?? <span className="muted">—</span>}</td>}
                    <td data-label="Pagamento">
                      {s.status === "completed" && s.paymentStatus !== "paid" ? (
                        <span className={`tag pay-tag ${s.paymentStatus}`}>
                          {s.paymentStatus === "partial"
                            ? `Parcial · falta ${money(Number(s.total) - Number(s.tradeInTotal) - Number(s.paidTotal))}`
                            : isPaymentLater(s) ? `${PAYMENT_LATER_LABEL} · a receber` : "A receber"}
                        </span>
                      ) : (
                        PAYMENT_LABELS[s.paymentMethod]
                      )}
                    </td>
                    {handoverReady && (
                      <td data-label={handoverWord(s.fulfillment)}>
                        {s.handoverDate ? <>{handoverWord(s.fulfillment)} {day(s.handoverDate)}</> : <span className="muted">—</span>}
                      </td>
                    )}
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
