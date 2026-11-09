"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { setSaleDateAction } from "./actions";

/** Mudar o dia de uma venda já lançada: retroativa ou agendada para outro dia. */
export function SaleDateForm({ saleId, value }: { saleId: string; value: string }) {
  const [state, action] = useActionState(setSaleDateAction, null);
  return (
    <form action={action} className="handover-form">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={saleId} />
      <label htmlFor="saleSoldOn">Data da venda</label>
      <div className="inline-form">
        <input id="saleSoldOn" name="soldOn" type="date" required defaultValue={value} key={value} />
        <SubmitButton className="secondary small" pendingText="Salvando...">Salvar</SubmitButton>
      </div>
    </form>
  );
}
