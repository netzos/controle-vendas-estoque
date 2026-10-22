"use client";

import { useActionState, useState } from "react";
import type { SupplierProduct } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { decimalInput, money, whatsappLink } from "@/lib/format";
import { removeSupplierPriceAction, setSupplierPriceAction } from "./actions";

type Option = { id: string; name: string };

// Preços combinados. Na ficha do fornecedor escolhe-se o produto; na ficha do
// produto, o fornecedor. É o mesmo vínculo visto dos dois lados.
export function SupplierPrices({
  side,
  ownerId,
  rows,
  options,
  canManage,
}: {
  side: "supplier" | "product";
  ownerId: string;
  rows: SupplierProduct[];
  options: Option[];
  canManage: boolean;
}) {
  const [state, action] = useActionState(setSupplierPriceAction, null);
  const [removeState, remove] = useActionState(removeSupplierPriceAction, null);
  const [editing, setEditing] = useState<SupplierProduct | null>(null);
  const [adding, setAdding] = useState(false);
  const other = side === "supplier" ? "productId" : "supplierId";
  const otherLabel = side === "supplier" ? "Produto" : "Fornecedor";
  const cheapest = side === "product" && rows.length > 1 ? rows[0]!.id : null;
  const taken = new Set(rows.map((r) => (side === "supplier" ? r.productId : r.supplierId)));
  const showForm = canManage && (adding || editing !== null);

  return (
    <>
      <div className="card-head">
        <h2>{side === "supplier" ? "Produtos e preços combinados" : "Fornecedores e preços combinados"}</h2>
        {canManage && !showForm && <button type="button" className="secondary" onClick={() => setAdding(true)}>+ Preço combinado</button>}
      </div>
      <FormMessage state={removeState} />
      {showForm && (
        <form action={action} key={editing?.id ?? "new"} className="subform">
          <FormMessage state={state} />
          <input type="hidden" name={side === "supplier" ? "supplierId" : "productId"} value={ownerId} />
          {editing && <input type="hidden" name={other} value={side === "supplier" ? editing.productId : editing.supplierId} />}
          <div className="grid-3">
            <Field label={otherLabel} name={other} state={state}>
              {editing ? (
                <input id={other} value={side === "supplier" ? editing.productName : editing.supplierName} disabled />
              ) : (
                <select id={other} name={other} defaultValue="" required>
                  <option value="" disabled>Escolha</option>
                  {options.filter((o) => !taken.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Preço combinado (R$)" name="agreedPrice" state={state}>
              <input id="agreedPrice" name="agreedPrice" inputMode="decimal" required defaultValue={decimalInput(editing?.agreedPrice, 2)} placeholder="0,00" />
            </Field>
            <Field label="Prazo (dias)" name="leadTimeDays" state={state} hint="Vazio usa o prazo do fornecedor.">
              <input id="leadTimeDays" name="leadTimeDays" inputMode="numeric" maxLength={3} defaultValue={editing?.leadTimeDays ?? ""} />
            </Field>
            <Field label="Código no fornecedor" name="supplierCode" state={state}>
              <input id="supplierCode" name="supplierCode" maxLength={60} defaultValue={editing?.supplierCode ?? ""} />
            </Field>
          </div>
          <Field label="Observação" name="notes" state={state}>
            <input id="notes" name="notes" maxLength={500} defaultValue={editing?.notes ?? ""} placeholder="Ex.: pedido mínimo de 10 unidades" />
          </Field>
          <div className="actions">
            <SubmitButton>Salvar preço</SubmitButton>
            <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null); }}>Fechar</button>
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="chart-empty">
          {side === "supplier" ? "Nenhum produto com preço combinado com este fornecedor." : "Nenhum fornecedor com preço combinado para este produto."}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{otherLabel}</th><th className="num">Preço combinado</th><th className="num">Custo atual</th><th className="num">Prazo</th><th>Obs.</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = Number(r.agreedPrice) - Number(r.costPrice);
                const whats = r.supplierWhatsapp;
                return (
                  <tr key={r.id}>
                    <td>
                      {side === "supplier" ? r.productName : r.supplierName}
                      {r.id === cheapest && <span className="tag ok">mais barato</span>}
                      <small className="muted">{side === "supplier" ? r.sku : ""}{r.supplierCode ? `${side === "supplier" ? " · " : ""}cód. ${r.supplierCode}` : ""}</small>
                    </td>
                    <td className="num"><strong>{money(r.agreedPrice)}</strong></td>
                    <td className="num">
                      {Number(r.costPrice) > 0 ? money(r.costPrice) : "—"}
                      {Number(r.costPrice) > 0 && Math.abs(diff) >= 0.005 && <small className={diff > 0 ? "qty-out" : "qty-in"}>{diff > 0 ? "+" : "−"}{money(Math.abs(diff))}</small>}
                    </td>
                    <td className="num">{r.leadTimeDays == null ? "—" : `${r.leadTimeDays} ${r.leadTimeDays === 1 ? "dia" : "dias"}`}</td>
                    <td className="muted">{r.notes}</td>
                    <td className="row-actions">
                      {whats && (
                        <a className="button secondary small" target="_blank" rel="noreferrer"
                          href={whatsappLink(whats, `Olá! Quero pedir ${r.productName}${r.supplierCode ? ` (cód. ${r.supplierCode})` : ""}.`)}>
                          Pedir no WhatsApp
                        </a>
                      )}
                      {canManage && (
                        <>
                          <button type="button" className="secondary small" onClick={() => { setAdding(false); setEditing(r); }}>Editar</button>
                          <form action={remove}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton className="secondary small" pendingText="...">Remover</SubmitButton>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
