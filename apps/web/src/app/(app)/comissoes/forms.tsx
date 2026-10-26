"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { payoutAction, setRateAction } from "./actions";

export function RateForm({ userId, rate }: { userId: string; rate: string | null }) {
  const [state, action] = useActionState(setRateAction, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="userId" value={userId} />
      <input name="rate" inputMode="decimal" defaultValue={rate ?? ""} placeholder="0" aria-label="Taxa (%)" size={4} required />
      <span className="muted">%</span>
      {state && !state.ok ? <span className="warn-text">{state.message}</span> : <SubmitButton className="secondary small" pendingText="...">Salvar</SubmitButton>}
    </form>
  );
}

export function PayoutForm({ month, people }: { month: string; people: { id: string; name: string; toPay: string }[] }) {
  const [state, action] = useActionState(payoutAction, null);
  return (
    <form action={action} key={state?.ok ? String(Math.random()) : "form"}>
      <FormMessage state={state} />
      <input type="hidden" name="month" value={month} />
      <div className="grid-3">
        <Field label="Vendedor" name="userId" state={state}>
          <select id="userId" name="userId" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{Number(p.toPay) > 0 ? ` (falta R$ ${p.toPay.replace(".", ",")})` : ""}</option>)}
          </select>
        </Field>
        <Field label="Valor (R$)" name="amount" state={state}>
          <input id="amount" name="amount" inputMode="decimal" required placeholder="0,00" />
        </Field>
        <Field label="Como pagou" name="method" state={state}>
          <select id="method" name="method" defaultValue="pix">
            <option value="pix">Pix</option>
            <option value="cash">Dinheiro</option>
            <option value="other">Outro</option>
          </select>
        </Field>
      </div>
      <Field label="Observação (opcional)" name="notes" state={state}>
        <input id="notes" name="notes" maxLength={300} />
      </Field>
      <div className="actions"><SubmitButton>Registrar repasse</SubmitButton></div>
    </form>
  );
}
