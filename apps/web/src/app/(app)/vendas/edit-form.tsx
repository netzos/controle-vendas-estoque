"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { updateSaleAction } from "./actions";

interface Line { productId: string; name: string; quantity: string; unitPrice: string }

/** Melhoria 17: corrigir itens, quantidades e preços de uma venda já registrada. */
export function EditSaleForm({
  saleId,
  items,
  products,
  canChangePrice,
}: {
  saleId: string;
  items: Line[];
  products: { id: string; name: string; price: string }[];
  canChangePrice: boolean;
}) {
  const [state, action] = useActionState(updateSaleAction, null);
  const [lines, setLines] = useState<Line[]>(items);
  const [adding, setAdding] = useState("");
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => {
    const p = products.find((x) => x.id === adding);
    if (!p) return;
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, name: p.name, quantity: "1", unitPrice: p.price }]));
    setAdding("");
  };
  const payload = JSON.stringify(lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })));
  return (
    <details className="imp-correct" open={state?.ok === false || undefined}>
      <summary>Corrigir itens da venda</summary>
      <form action={action} className="edit-sale">
        <FormMessage state={state} />
        <input type="hidden" name="id" value={saleId} />
        <input type="hidden" name="items" value={payload} />
        <p className="muted">O número e os pagamentos continuam os mesmos. O estoque muda só pela diferença.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th className="num">Qtd.</th><th className="num">Preço</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td className="num">
                    <input inputMode="decimal" aria-label={`Quantidade de ${l.name}`} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} size={5} />
                  </td>
                  <td className="num">
                    <input inputMode="decimal" aria-label={`Preço de ${l.name}`} value={l.unitPrice} readOnly={!canChangePrice} onChange={(e) => set(i, { unitPrice: e.target.value })} size={7} />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="secondary small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Tirar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="edit-sale-add">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Acrescentar produto">
            <option value="">Acrescentar produto...</option>
            {products.filter((p) => !lines.some((l) => l.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="secondary" onClick={add} disabled={!adding}>Acrescentar</button>
        </div>
        <label className="field">
          <span>Motivo (opcional)</span>
          <input name="reason" maxLength={300} placeholder="Ex.: cliente levou mais duas latas" />
        </label>
        <SubmitButton pendingText="Salvando...">Salvar correção</SubmitButton>
      </form>
    </details>
  );
}
