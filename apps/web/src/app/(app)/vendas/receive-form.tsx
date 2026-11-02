"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { receivePaymentAction } from "./actions";

const METHODS = [
  { key: "pix", label: "Pix" },
  { key: "cash", label: "Dinheiro" },
  { key: "debit", label: "Débito" },
  { key: "credit", label: "Crédito" },
  { key: "other", label: "Outro" },
];

/**
 * Receber o que falta de uma venda com pagamento parcial (ou tudo, se ficou a receber).
 * Na venda parcelada, installmentId diz qual parcela recebe primeiro; o que passar vai para as seguintes.
 */
export function ReceivePaymentForm({ saleId, open, installmentId, hint }: { saleId: string; open: string; installmentId?: string; hint?: string }) {
  const [state, action] = useActionState(receivePaymentAction, null);
  const openLabel = Number(open).toFixed(2).replace(".", ",");
  return (
    <form action={action} className="receive-form">
      <FormMessage state={state} />
      <input type="hidden" name="saleId" value={saleId} />
      {installmentId && <input type="hidden" name="installmentId" value={installmentId} />}
      <div className="grid-3">
        <Field label="Valor recebido (R$)" name="amount" state={state} hint={hint ?? `Falta ${openLabel}`}>
          <input id="amount" name="amount" inputMode="decimal" defaultValue={openLabel} required key={open} />
        </Field>
        <Field label="Forma" name="method" state={state}>
          <select id="method" name="method" defaultValue="pix">
            {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Observação" name="notes" state={state}>
          <input id="notes" name="notes" maxLength={300} placeholder="Opcional" />
        </Field>
      </div>
      <SubmitButton pendingText="Registrando...">Registrar recebimento</SubmitButton>
    </form>
  );
}
