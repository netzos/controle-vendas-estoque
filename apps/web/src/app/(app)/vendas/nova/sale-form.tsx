"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { money, quantity } from "@/lib/format";
import { DELIVERY_STEP, FULFILLMENTS, ITEM_TYPES, ORDER_STEP, type Fulfillment, type ItemType } from "@erp/core/labels";
import { createSaleAction } from "../actions";

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: string;
  unitCode: string;
  trackStock: boolean;
  /** Sem estoque, segue vendendo por encomenda. */
  backorder: boolean;
  itemType: ItemType;
  imageId: string | null;
  steps: string[];
}

type StepDraft = { scheduledFor: string; responsible: string; cost: string };
export type StepDefault = { name: string; days: number | null; responsible: string | null; cost: string | null };

const PAYMENTS = [
  { key: "pix", label: "Pix" },
  { key: "cash", label: "Dinheiro" },
  { key: "debit", label: "Débito" },
  { key: "credit", label: "Crédito" },
  { key: "other", label: "Outro" },
] as const;

// Quantidade digitada com vírgula: "1,5" → 1.5.
const toNumber = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

export function SaleForm({
  products,
  customers,
  canChangePrice,
  canTradeIn,
  canManageSteps,
  today,
  stepDefaults,
  defaultFulfillment,
}: {
  products: PosProduct[];
  customers: { id: string; name: string }[];
  canChangePrice: boolean;
  canTradeIn: boolean;
  canManageSteps: boolean;
  today: string;
  stepDefaults: StepDefault[];
  defaultFulfillment: Fulfillment;
}) {
  const [state, action] = useActionState(createSaleAction, null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, string>>({});
  const [payment, setPayment] = useState<string>("pix");
  const [discount, setDiscount] = useState("");
  // Preço negociado por item; vazio = preço do cadastro.
  const [prices, setPrices] = useState<Record<string, string>>({});
  // Itens que o cliente entrega como parte do pagamento.
  const [trades, setTrades] = useState<{ key: number; productId: string; name: string; value: string }[]>([]);
  // Depois da venda: endereço, taxa cobrada e prazo/responsável/custo de cada etapa.
  const [after, setAfter] = useState({ address: "", recipient: "", phone: "", fee: "" });
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  // Retirada no local ou entrega. Sem permissão de etapas, é sempre retirada.
  const [way, setWay] = useState<Fulfillment>(canManageSteps ? defaultFulfillment : "pickup");

  // Venda registrada: limpa o carrinho para a próxima.
  useEffect(() => {
    if (state?.ok) {
      setCart({});
      setPrices({});
      setTrades([]);
      setAfter({ address: "", recipient: "", phone: "", fee: "" });
      setStepDrafts({});
      setWay(canManageSteps ? defaultFulfillment : "pickup");
      setDiscount("");
      setSearch("");
    }
  }, [state]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const term = search.trim().toLowerCase();
  const shown = term ? products.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)) : products;

  const priceOf = (p: PosProduct) => (prices[p.id]?.trim() ? toNumber(prices[p.id]!) : Number(p.price));
  const lines = Object.entries(cart).map(([id, qty]) => ({ product: byId.get(id)!, qty }));
  const subtotal = lines.reduce((a, l) => a + Math.round(toNumber(l.qty) * priceOf(l.product) * 100) / 100, 0);
  // Quanto de cada linha passa do estoque (vai por encomenda).
  const owed = (p: PosProduct, qty: string) =>
    p.itemType === "made_to_order" ? toNumber(qty) : p.trackStock ? Math.max(toNumber(qty) - Math.max(Number(p.stock), 0), 0) : 0;
  const anyOwed = lines.some((l) => owed(l.product, l.qty) > 0);
  // Etapas dos itens no carrinho, sem repetir, na ordem em que aparecem.
  // Entrega só existe quando a venda vai entregue; na retirada ela sai da lista.
  const isDelivery = (n: string) => n.toLowerCase() === DELIVERY_STEP.toLowerCase();
  const stepNames = [...(anyOwed ? [ORDER_STEP] : []), ...lines.flatMap((l) => l.product.steps), ...(way === "delivery" ? [DELIVERY_STEP] : [])]
    .filter((n, i, all) => all.findIndex((o) => o.toLowerCase() === n.toLowerCase()) === i)
    .filter((n) => way === "delivery" || !isDelivery(n));
  const defaultOf = (n: string) => stepDefaults.find((d) => d.name.toLowerCase() === n.toLowerCase());
  const hasAfter = canManageSteps && stepNames.length > 0;
  const fee = hasAfter && way === "delivery" ? toNumber(after.fee) : 0;
  const total = Math.max(subtotal - toNumber(discount), 0) + fee;
  const tradeTotal = trades.reduce((a, t) => a + toNumber(t.value), 0);
  const toPay = total - tradeTotal;
  const tracked = products.filter((p) => p.trackStock);
  const draftOf = (n: string): StepDraft => stepDrafts[n] ?? { scheduledFor: "", responsible: "", cost: "" };
  const setDraft = (n: string, patch: Partial<StepDraft>) => setStepDrafts((d) => ({ ...d, [n]: { ...draftOf(n), ...patch } }));
  const setTrade = (key: number, patch: Partial<(typeof trades)[number]>) => setTrades((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const add = (id: string) => setCart((c) => ({ ...c, [id]: String(toNumber(c[id] ?? "0") + 1).replace(".", ",") }));
  const dec = (id: string) =>
    setCart((c) => {
      const next = toNumber(c[id] ?? "0") - 1;
      const { [id]: _, ...rest } = c;
      return next > 0 ? { ...c, [id]: String(next).replace(".", ",") } : rest;
    });

  return (
    <form action={action} className="pos">
      <input type="hidden" name="items" value={JSON.stringify(
        lines.map((l) => {
          const changed = prices[l.product.id]?.trim() && priceOf(l.product) !== Number(l.product.price);
          return changed ? { productId: l.product.id, quantity: l.qty, unitPrice: prices[l.product.id] } : { productId: l.product.id, quantity: l.qty };
        }),
      )} />
      <input type="hidden" name="paymentMethod" value={payment} />
      <input type="hidden" name="fulfillment" value={way} />
      {hasAfter && (
        <input
          type="hidden"
          name="followup"
          value={JSON.stringify({
            ...(way === "delivery" ? after : {}),
            steps: stepNames.map((name) => ({ name, ...draftOf(name), cost: draftOf(name).cost || undefined })),
          })}
        />
      )}
      <input
        type="hidden"
        name="tradeIns"
        value={JSON.stringify(trades.map((t) => (t.productId ? { productId: t.productId, value: t.value } : { name: t.name, value: t.value })))}
      />

      <section className="card pos-catalog">
        <input type="search" placeholder="Buscar produto por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
        {products.length === 0 ? (
          <p className="chart-empty">Cadastre produtos para começar a vender.</p>
        ) : (
          <div className="pos-grid">
            {shown.map((p) => {
              const inCart = cart[p.id];
              const stock = Number(p.stock);
              const soldOut = p.trackStock && stock <= 0 && !p.backorder;
              return (
                <button type="button" key={p.id} className={`pos-item${inCart ? " selected" : ""}`} onClick={() => add(p.id)} disabled={soldOut}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.imageId && <img className="pos-thumb" src={`/imagens/${p.imageId}`} alt="" loading="lazy" />}
                  <span className="pos-name">{p.name}</span>
                  <span className="pos-price">{money(p.price)}</span>
                  <span className={`pos-stock${p.trackStock && stock <= 0 ? " out" : ""}`}>
                    {!p.trackStock
                      ? ITEM_TYPES[p.itemType].label
                      : stock > 0
                        ? `${quantity(p.stock)} ${p.unitCode} em estoque`
                        : p.backorder ? "Sem estoque · vende por encomenda" : "Esgotado"}
                  </span>
                  {inCart && <span className="pos-badge">{inCart}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card pos-cart" id="venda">
        <h2>Venda</h2>
        <FormMessage state={state} />
        {lines.length === 0 ? (
          <p className="chart-empty">Toque nos produtos para adicionar.</p>
        ) : (
          <ul className="cart-lines">
            {lines.map(({ product: p, qty }) => (
              <li key={p.id}>
                <div className="cart-name">
                  <span>{p.name}</span>
                  {owed(p, qty) > 0 && (
                    <small className={p.backorder || p.itemType === "made_to_order" ? "cart-owed" : "cart-owed warn"}>
                      {p.backorder || p.itemType === "made_to_order"
                        ? `${quantity(String(owed(p, qty)))} por encomenda`
                        : `Só tem ${quantity(String(Math.max(Number(p.stock), 0)))} em estoque`}
                    </small>
                  )}
                  {canChangePrice ? (
                    <label className="line-price">
                      <span>R$</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Preço de ${p.name}`}
                        placeholder={Number(p.price).toFixed(2).replace(".", ",")}
                        value={prices[p.id] ?? ""}
                        onChange={(e) => setPrices((c) => ({ ...c, [p.id]: e.target.value }))}
                      />
                      <small>/ {p.unitCode}</small>
                    </label>
                  ) : (
                    <small>{money(p.price)} / {p.unitCode}</small>
                  )}
                </div>
                <div className="stepper">
                  <button type="button" className="secondary" onClick={() => dec(p.id)} aria-label={`Menos ${p.name}`}>−</button>
                  <input
                    value={qty}
                    inputMode="decimal"
                    aria-label={`Quantidade de ${p.name}`}
                    onChange={(e) => setCart((c) => ({ ...c, [p.id]: e.target.value }))}
                  />
                  <button type="button" className="secondary" onClick={() => add(p.id)} aria-label={`Mais ${p.name}`}>+</button>
                </div>
                <strong className="cart-total">{money(Math.round(toNumber(qty) * priceOf(p) * 100) / 100)}</strong>
              </li>
            ))}
          </ul>
        )}

        {canTradeIn && (
          <div className="trade-ins">
            {trades.map((t) => (
              <div className="trade-row" key={t.key}>
                <select aria-label="Item recebido" value={t.productId} onChange={(e) => setTrade(t.key, { productId: e.target.value })}>
                  <option value="">Item novo</option>
                  {tracked.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {!t.productId && <input aria-label="O que foi recebido" placeholder="O que recebeu (ex.: Onix 2019)" value={t.name} onChange={(e) => setTrade(t.key, { name: e.target.value })} />}
                <input aria-label="Valor da troca" inputMode="decimal" placeholder="Valor R$" value={t.value} onChange={(e) => setTrade(t.key, { value: e.target.value })} className="trade-value" />
                <button type="button" className="secondary small" onClick={() => setTrades((ts) => ts.filter((x) => x.key !== t.key))} aria-label="Tirar item da troca">×</button>
              </div>
            ))}
            <button type="button" className="secondary small" onClick={() => setTrades((ts) => [...ts, { key: Date.now(), productId: "", name: "", value: "" }])}>
              + Recebeu um item na troca
            </button>
          </div>
        )}

        {canManageSteps && lines.length > 0 && (
          <div className="pay-options" role="radiogroup" aria-label="Retirada ou entrega">
            {(["pickup", "delivery"] as const).map((w) => (
              <button type="button" key={w} role="radio" aria-checked={way === w} className={way === w ? "active" : ""} onClick={() => setWay(w)}>
                {FULFILLMENTS[w]}
              </button>
            ))}
          </div>
        )}

        {hasAfter && (
          <details className="after-sale" open>
            <summary>{way === "delivery" ? "Entrega e etapas" : "Depois da venda"} <span className="muted">· {stepNames.join(", ")}</span></summary>
            {way === "delivery" && <div className="grid-2">
              <input aria-label="Endereço" placeholder="Endereço" value={after.address} onChange={(e) => setAfter({ ...after, address: e.target.value })} />
              <input aria-label="Quem recebe" placeholder="Quem recebe" value={after.recipient} onChange={(e) => setAfter({ ...after, recipient: e.target.value })} />
              <input aria-label="Telefone de contato" placeholder="Telefone" inputMode="tel" value={after.phone} onChange={(e) => setAfter({ ...after, phone: e.target.value })} />
              <input aria-label="Taxa cobrada do cliente" placeholder="Frete cobrado do cliente R$" inputMode="decimal" value={after.fee} onChange={(e) => setAfter({ ...after, fee: e.target.value })} />
            </div>}
            {stepNames.map((n) => (
              <div className="after-step" key={n}>
                <strong>{n}</strong>
                <input type="date" aria-label={`Prazo de ${n}`} min={today} value={draftOf(n).scheduledFor} onChange={(e) => setDraft(n, { scheduledFor: e.target.value })} />
                <input
                  aria-label={`Responsável por ${n}`}
                  placeholder={defaultOf(n)?.responsible ?? "Responsável"}
                  value={draftOf(n).responsible}
                  onChange={(e) => setDraft(n, { responsible: e.target.value })}
                />
                <input
                  aria-label={isDelivery(n) ? "Custo do transporte" : `Custo de ${n}`}
                  placeholder={defaultOf(n)?.cost ? money(defaultOf(n)!.cost!) : isDelivery(n) ? "Custo do transporte R$" : "Custo R$"}
                  inputMode="decimal"
                  value={draftOf(n).cost}
                  onChange={(e) => setDraft(n, { cost: e.target.value })}
                />
              </div>
            ))}
            <p className="muted small-text">
              Em branco usa o padrão de cada etapa (prazo, responsável e custo). O custo (motoboy, instalador) entra em Custos e desconta do lucro real.
            </p>
          </details>
        )}

        <div className="pay-options" role="radiogroup" aria-label="Forma de pagamento">
          {PAYMENTS.map((p) => (
            <button type="button" key={p.key} role="radio" aria-checked={payment === p.key} className={payment === p.key ? "active" : ""} onClick={() => setPayment(p.key)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="customerId">Cliente (opcional)</label>
            <select id="customerId" name="customerId" defaultValue="">
              <option value="">Consumidor</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="discount">Desconto (R$)</label>
            <input id="discount" name="discount" inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
        </div>

        <div className="cart-sum">
          <span>
            Subtotal <b>{money(subtotal)}</b>
            {fee > 0 && <> · Taxa <b>+{money(fee)}</b></>}
            {tradeTotal > 0 && <> · Troca <b>−{money(tradeTotal)}</b></>}
          </span>
          <span className="cart-grand">{money(tradeTotal > 0 ? Math.max(toPay, 0) : total)}</span>
        </div>
        {tradeTotal > 0 && <p className={`muted trade-note${toPay < 0 ? " warn-text" : ""}`}>{toPay < 0 ? "A troca passa do valor da venda." : `Venda de ${money(total)}; falta receber ${money(toPay)}.`}</p>}
        <SubmitButton className="block" pendingText="Registrando...">Finalizar venda</SubmitButton>
      </section>

      {/* Celular: o total fica sempre à vista enquanto a pessoa escolhe os produtos. */}
      {lines.length > 0 && (
        <a href="#venda" className="pos-bar">
          <span>
            {lines.length} {lines.length === 1 ? "item" : "itens"}
            <b>{money(tradeTotal > 0 ? Math.max(toPay, 0) : total)}</b>
          </span>
          <em>Finalizar →</em>
        </a>
      )}
    </form>
  );
}
