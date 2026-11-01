"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { cancelSaleAction, deleteSaleAction } from "./actions";

export function CancelSaleForm({ id }: { id: string }) {
  const [state, action] = useActionState(cancelSaleAction, null);
  return (
    <details className="imp-correct">
      <summary>Cancelar esta venda</summary>
      <form action={action}>
        <FormMessage state={state} />
        <input type="hidden" name="id" value={id} />
        <Field label="Motivo" name="reason" state={state}>
          <input id="reason" name="reason" required minLength={3} maxLength={500} placeholder="Ex.: cliente desistiu" />
        </Field>
        <SubmitButton className="danger" pendingText="Cancelando...">Cancelar venda e devolver ao estoque</SubmitButton>
      </form>
    </details>
  );
}

/** Excluir a venda de vez, com confirmação. Diferente de cancelar, não fica histórico. */
export function DeleteSaleForm({ id, number }: { id: string; number: number }) {
  const [state, action] = useActionState(deleteSaleAction, null);
  const [asking, setAsking] = useState(false);
  return (
    <div className="remove-record">
      <FormMessage state={state} />
      {asking ? (
        <form action={action} className="remove-confirm">
          <input type="hidden" name="id" value={id} />
          <span>
            Excluir a venda nº <b>{number}</b> por completo? Somem os itens, pagamentos, parcelas e etapas, e o estoque volta ao que era antes
            dela. Não dá para desfazer.
          </span>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setAsking(false)}>Não</button>
            <SubmitButton className="danger" pendingText="Excluindo...">Sim, excluir venda</SubmitButton>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary danger-text" onClick={() => setAsking(true)}>Excluir venda</button>
      )}
    </div>
  );
}
