"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { setHandoverDateAction } from "./actions";

/** Marcar ou mudar o dia em que o cliente retira (ou recebe) a venda. */
export function HandoverDateForm({ saleId, value, label }: { saleId: string; value: string | null; label: string }) {
  const [state, action] = useActionState(setHandoverDateAction, null);
  return (
    <form action={action} className="handover-form">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={saleId} />
      <label htmlFor="handoverDate">{label}</label>
      <div className="inline-form">
        <input id="handoverDate" name="handoverDate" type="date" defaultValue={value ?? ""} key={value ?? ""} />
        <SubmitButton className="secondary small" pendingText="Salvando...">Salvar</SubmitButton>
      </div>
    </form>
  );
}
