"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { cancelSaleAction } from "./actions";

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
