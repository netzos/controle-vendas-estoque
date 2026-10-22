"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { money, quantity } from "@/lib/format";
import { createSaleAction } from "../actions";

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: string;
  unitCode: string;
  trackStock: boolean;
}

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
}: {
  products: PosProduct[];
  customers: { id: string; name: string }[];
  canChangePrice: boolean;
}) {
  const [state, action] = useActionState(createSaleAction, null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, string>>({});
  const [payment, setPayment] = useState<string>("pix");
  const [discount, setDiscount] = useState("");
  // Preço negociado por item; vazio = preço do cadastro.
  const [prices, setPrices] = useState<Record<string, string>>({});

  // Venda registrada: limpa o carrinho para a próxima.
  useEffect(() => {
    if (state?.ok) {
      setCart({});
      setPrices({});
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
  const total = Math.max(subtotal - toNumber(discount), 0);

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

      <section className="card pos-catalog">
        <input type="search" placeholder="Buscar produto por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
        {products.length === 0 ? (
          <p className="chart-empty">Cadastre produtos para começar a vender.</p>
        ) : (
          <div className="pos-grid">
            {shown.map((p) => {
              const inCart = cart[p.id];
              const stock = Number(p.stock);
              return (
                <button type="button" key={p.id} className={`pos-item${inCart ? " selected" : ""}`} onClick={() => add(p.id)}>
                  <span className="pos-name">{p.name}</span>
                  <span className="pos-price">{money(p.price)}</span>
                  <span className={`pos-stock${p.trackStock && stock <= 0 ? " out" : ""}`}>
                    {p.trackStock ? `${quantity(p.stock)} ${p.unitCode} em estoque` : "Sem controle de estoque"}
                  </span>
                  {inCart && <span className="pos-badge">{inCart}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card pos-cart">
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
          <span>Subtotal <b>{money(subtotal)}</b></span>
          <span className="cart-grand">{money(total)}</span>
        </div>
        <SubmitButton className="block" pendingText="Registrando...">Finalizar venda</SubmitButton>
      </section>
    </form>
  );
}
