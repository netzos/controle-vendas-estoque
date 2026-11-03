"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { completeFollowupAction } from "./actions";

/** Um clique para dizer que o cliente já levou: conclui as etapas que faltam (pedido nº 21). */
export function DeliverForm({ saleId, fulfillment }: { saleId: string; fulfillment: string }) {
  const [state, action] = useActionState(completeFollowupAction, null);
  const label = fulfillment === "delivery" ? "Marcar como entregue" : "Marcar como retirada";
  return (
    <form action={action} className="deliver-form">
      <FormMessage state={state} />
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="word" value={fulfillment} />
      <SubmitButton className="small" pendingText="Salvando...">{label}</SubmitButton>
      <small className="muted">Conclui as etapas que faltam. O pagamento não muda.</small>
    </form>
  );
}
