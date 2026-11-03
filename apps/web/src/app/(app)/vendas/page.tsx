import Link from "next/link";
import { can, enabledFeatures, listProducts, resolveRange, summarizeSales, type PaymentMethod, FULFILLMENTS, INSTALLMENT_STATUS_LABELS, INTERVAL_LABELS, PAYMENT_STATUS_LABELS, getOrganization, getSale, getSaleFollowup, listBranches, listSales, listStepTypes, orgDate, PAYMENT_LABELS, PAYMENT_LATER_LABEL, handoverDateReady, isPaymentLater } from "@erp/core";
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
import { DeliverForm } from "./deliver-form";
import { PeriodPicker } from "@/components/period-picker";
import { receiptLink } from "@/lib/receipt";

type ListParams = { q?: string; receber?: string; situacao?: string; filial?: string; periodo?: string; de?: string; ate?: string; forma?: string };

// Períodos da lista; "Todas as datas" é o padrão (a busca acha qualquer venda).
const PERIODS = [
  { key: "all", label: "Todas as datas" },
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "year", label: "Este ano" },
] as const;
const SITUATIONS = [
  { key: "entregue-sem-pagamento", value: "delivered_unpaid", label: "Entregue sem pagamento" },
  { key: "pago-sem-entrega", value: "paid_undelivered", label: "Pago sem entrega" },
] as const;

/** Entrega da venda: pendente enquanto o pós-venda estiver aberto; sem pós-venda, o cliente levou na hora. */
function handoverTag(s: { fulfillment: string; followupStatus: string | null }) {
  const delivery = s.fulfillment === "delivery";
  return s.followupStatus === "open"
    ? <span className="tag warn">{delivery ? "Entrega pendente" : "Retirada pendente"}</span>
    : <span className="tag ok">{delivery ? "Entregue" : "Retirado"}</span>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const METHODS: PaymentMethod[] = ["pix", "cash", "debit", "credit", "other"];

function listLink(p: ListParams, change: ListParams = {}) {
  const q = new URLSearchParams(Object.entries({ ...p, ...change }).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `/vendas?${q}` : "/vendas";
}

export const metadata = { title: "Vendas" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<ListParams & { id?: string; aviso?: string }> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const branches = can(actor, "branches.view") ? await query(listBranches, {}) : [];
  const multi = branches.length > 1;
  const branch = multi ? branches.find((b) => b.id === params.filial) : undefined;
  // Período da lista: datas escolhidas, um período pronto ou todas as datas.
  const today = await query(orgDate, {});
  const custom = !!(params.de && params.ate && DAY.test(params.de) && DAY.test(params.ate));
  const periodKey = custom ? "custom" : PERIODS.some((p) => p.key === params.periodo) ? params.periodo! : "all";
  let range: { from: string; to: string } | null = null;
  try {
    range = periodKey === "all" ? null : resolveRange(today, { period: periodKey as "today", from: params.de, to: params.ate });
  } catch {
    range = null; // datas inválidas (mais de 3 anos): mostra todas
  }
  const method = METHODS.find((m) => m === params.forma);
  // Entrega e pagamento separados (pedido nº 21).
  const situation = SITUATIONS.find((x) => x.key === params.situacao)?.value;
  const filters = {
    search: params.q || undefined,
    openPayment: params.receber === "1",
    branchId: branch?.id,
    from: range?.from,
    to: range?.to,
    paymentMethod: method,
    situation,
  };
  const [org, sales, totals, selected, features, handoverReady] = await Promise.all([
    query(getOrganization, {}),
    query(listSales, filters),
    query(summarizeSales, filters),
    params.id ? query(getSale, { id: params.id }).catch(() => null) : null,
    enabledFeatures(db(), actor.organizationId),
    handoverDateReady(db()),
  ]);
  const seesSteps = features.has("deliveries") && can(actor, "deliveries.view");
  const [followup, stepTypes] = selected && seesSteps
    ? await Promise.all([query(getSaleFollowup, { saleId: selected.id }), query(listStepTypes, {})])
    : [null, []];
  const canSteps = can(actor, "deliveries.manage");
  // Corrigir itens: venda concluída e ainda não paga por inteiro (melhoria 17).
  const canEdit = !!selected && selected.status === "completed" && can(actor, "sales.create") && !actor.platformView &&
    !(selected.paymentStatus === "paid" && Number(selected.paidTotal) > 0);
  const editProducts = canEdit ? await query(listProducts, { limit: 500 }) : [];
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  // "2026-11-02" → "02/11"; o ano só aparece quando não é o atual.
  const year = String(new Date().getFullYear());
  const day = (d: string) => { const [y, m, dd] = d.split("-"); return y === year ? `${dd}/${m}` : `${dd}/${m}/${y}`; };
  const keep: ListParams = { q: params.q, receber: params.receber, situacao: params.situacao, filial: params.filial, forma: params.forma };
  const current: ListParams = { ...keep, periodo: periodKey === "all" || periodKey === "custom" ? undefined : periodKey, de: custom ? params.de : undefined, ate: custom ? params.ate : undefined };
  const rangeText = range ? (range.from === range.to ? day(range.from) : `${day(range.from)} a ${day(range.to)}`) : "";
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
              {selected.status === "completed" ? (
                <>
                  {handoverTag(selected)}{" "}
                  <span className={`tag pay-tag ${selected.paymentStatus}`}>{selected.paymentStatus === "paid" ? "Pago" : PAYMENT_STATUS_LABELS[selected.paymentStatus]}</span>
                </>
              ) : (
                <span className="tag off">Cancelada</span>
              )}
            </span>
          </div>
          <p className="muted">
            {fmt.format(selected.soldAt)} · {FULFILLMENTS[selected.fulfillment]}
            {selected.handoverDate && <> em <b>{day(selected.handoverDate)}</b></>} · {selected.customerName ?? "Consumidor"} · por {selected.userName}
          </p>
          {selected.status === "completed" && (
            <p>
              <a className="button secondary small" href={receiptLink(selected, org.name, org.timezone)} target="_blank" rel="noreferrer">
                Mandar recibo pelo WhatsApp{selected.customerPhone ? "" : " (escolher contato)"}
              </a>
            </p>
          )}
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
          {selected.installments.length > 0 && (
            <>
              <p className="muted">
                {Number(selected.downPayment) > 0 ? `Entrada de ${money(selected.downPayment)} + ` : "Sem entrada · "}
                {selected.installments.length}x {selected.installmentInterval ? INTERVAL_LABELS[selected.installmentInterval].toLowerCase() : ""}
              </p>
              <div className="table-wrap">
                <table className="cards">
                  <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Pago</th><th>Situação</th></tr></thead>
                  <tbody>
                    {selected.installments.map((i) => (
                      <tr key={i.id}>
                        <td data-label="Parcela">{i.number}/{selected.installments.length}</td>
                        <td data-label="Vencimento">{day(i.dueDate)}</td>
                        <td data-label="Valor" className="num">{money(i.amount)}</td>
                        <td data-label="Pago" className="num">{Number(i.paidAmount) > 0 ? money(i.paidAmount) : "—"}{i.paidOn && <small className="muted">em {day(i.paidOn)}</small>}</td>
                        <td data-label="Situação"><span className={`tag inst-tag ${i.status}`}>{INSTALLMENT_STATUS_LABELS[i.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
            // Parcelada: o formulário já vem com a próxima parcela em aberto.
            const next = selected.installments.find((i) => i.status !== "paid" && i.status !== "cancelled");
            const nextOpen = next ? (Number(next.amount) - Number(next.paidAmount)).toFixed(2) : open.toFixed(2);
            return (
              <div className="open-box">
                <p><b>Falta receber {money(open)}</b> de {money(Number(selected.total) - Number(selected.tradeInTotal))}.</p>
                {can(actor, "sales.receive") && (
                  <ReceivePaymentForm
                    saleId={selected.id}
                    open={nextOpen}
                    installmentId={next?.id}
                    hint={next ? `Parcela ${next.number} · vence ${day(next.dueDate)}. Se passar, vai para as próximas.` : undefined}
                  />
                )}
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
              {followup.status === "open" && selected.status === "completed" && canSteps && !actor.platformView && (
                <DeliverForm saleId={selected.id} fulfillment={selected.fulfillment} />
              )}
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
            {situation && <input type="hidden" name="situacao" value={params.situacao} />}
            {(["periodo", "de", "ate", "forma"] as const).map((k) => current[k] && <input key={k} type="hidden" name={k} value={current[k]} />)}
            {multi && (
              <select name="filial" defaultValue={branch?.id ?? ""} aria-label="Filial">
                <option value="">Todas as filiais</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button type="submit" className="secondary">Buscar</button>
          </form>
          <nav className="segmented" aria-label="Filtro de pagamento">
            <Link href={listLink(current, { receber: undefined, situacao: undefined })} className={params.receber === "1" || situation ? "" : "active"}>Todas</Link>
            <Link href={listLink(current, { receber: "1", situacao: undefined })} className={params.receber === "1" && !situation ? "active" : ""}>Falta receber</Link>
            {seesSteps && SITUATIONS.map((x) => (
              <Link key={x.key} href={listLink(current, { receber: undefined, situacao: x.key })} className={params.situacao === x.key ? "active" : ""}>{x.label}</Link>
            ))}
          </nav>
          {can(actor, "sales.create") && <Link className="button hide-mobile" href="/vendas/nova">+ Nova venda</Link>}
        </div>
        <div className="list-period">
          <PeriodPicker
            options={[...PERIODS]}
            current={periodKey}
            label={periodKey === "custom" ? "Período escolhido" : PERIODS.find((p) => p.key === periodKey)!.label}
            range={rangeText}
            from={range?.from ?? today}
            to={range?.to ?? today}
            links={Object.fromEntries(PERIODS.map((p) => [p.key, listLink(keep, { periodo: p.key === "all" ? undefined : p.key })]))}
            customLink={listLink(keep)}
            selects={[{
              label: "Forma de pagamento",
              all: "Todas as formas",
              value: method ?? "",
              options: METHODS.map((m) => ({ id: m, name: PAYMENT_LABELS[m] })),
              links: Object.fromEntries([["", listLink(current, { forma: undefined })], ...METHODS.map((m) => [m, listLink(current, { forma: m })])]),
            }]}
          />
          <p className="list-totals">
            <span><b>{money(totals.total)}</b> em {totals.count} {totals.count === 1 ? "venda" : "vendas"}</span>
            <span>Recebido <b>{money(totals.received)}</b></span>
            {Number(totals.open) > 0 && <Link href={listLink(current, { receber: "1" })}>Falta receber <b>{money(totals.open)}</b></Link>}
            {totals.cancelled > 0 && <span className="muted">{totals.cancelled} {totals.cancelled === 1 ? "cancelada" : "canceladas"} fora da soma</span>}
          </p>
        </div>
        {totals.count + totals.cancelled > sales.length && (
          <p className="muted small-text">Mostrando as {sales.length} mais recentes. O total acima soma todas.</p>
        )}
        {sales.length === 0 ? (
          <p className="muted">{situation ? "Nenhuma venda nessa situação." : params.receber === "1" ? "Nenhuma venda com pagamento em aberto." : params.q || range || method ? "Nenhuma venda encontrada com esses filtros." : "Nenhuma venda registrada ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Nº</th><th>Data</th><th>Cliente</th>{multi && <th>Filial</th>}<th>Pagamento</th>{handoverReady && <th>Retirada</th>}<th className="num">Itens</th><th className="num">Total</th><th>{seesSteps ? "Entrega" : "Situação"}</th></tr>
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
                          {s.installmentCount > 0
                            ? `${s.installmentCount}x · falta ${money(Number(s.total) - Number(s.tradeInTotal) - Number(s.paidTotal))}`
                            : s.paymentStatus === "partial"
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
                    <td data-label={seesSteps ? "Entrega" : "Situação"}>
                      {s.status === "cancelled" ? <span className="tag off">Cancelada</span> : seesSteps ? handoverTag(s) : <span className="tag ok">Concluída</span>}
                    </td>
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
