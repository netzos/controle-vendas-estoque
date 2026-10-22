"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { fixedCostAction, usdBrlAction } from "./actions";

const br = (v: string) => (Number(v) ? Number(v).toFixed(2).replace(".", ",") : "");

/** Um custo fixo da plataforma (novo quando não tem id). */
export function FixedCostForm({ cost }: { cost?: { id: string; name: string; monthlyBrl: string; status: string } }) {
  const [state, action] = useActionState(fixedCostAction, null);
  return (
    <form action={action} className="fixed-cost">
      <input type="hidden" name="id" value={cost?.id ?? ""} />
      <Field label="Nome" name="name" state={state}>
        <input id={`name-${cost?.id ?? "novo"}`} name="name" required maxLength={80} defaultValue={cost?.name ?? ""} placeholder="Ex.: Vercel, Supabase, domínio" />
      </Field>
      <Field label="Por mês (R$)" name="monthlyBrl" state={state}>
        <input id={`brl-${cost?.id ?? "novo"}`} name="monthlyBrl" inputMode="decimal" required defaultValue={cost ? br(cost.monthlyBrl) : ""} placeholder="0,00" />
      </Field>
      {cost && (
        <Field label="Situação" name="status" state={state}>
          <select id={`st-${cost.id}`} name="status" defaultValue={cost.status}>
            <option value="active">Ativo</option>
            <option value="inactive">Parado</option>
          </select>
        </Field>
      )}
      <SubmitButton className={cost ? "secondary small" : "small"}>{cost ? "Salvar" : "Adicionar"}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function UsdBrlForm({ rate }: { rate: number }) {
  const [state, action] = useActionState(usdBrlAction, null);
  return (
    <form action={action} className="fixed-cost">
      <Field label="1 dólar em reais" name="rate" state={state}>
        <input id="rate" name="rate" inputMode="decimal" required defaultValue={rate.toFixed(2).replace(".", ",")} />
      </Field>
      <SubmitButton className="secondary small">Salvar cotação</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
