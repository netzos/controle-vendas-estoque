"use client";

import { useActionState } from "react";
import type { SettingValues } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { updateSettingsAction } from "./actions";

export function SettingsForm({ values, readOnly, deliveries }: { values: SettingValues; readOnly: boolean; deliveries: boolean }) {
  const [state, action] = useActionState(updateSettingsAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label="Nome exibido em documentos e mensagens" name="general.trade_name_on_documents" state={state} hint="Se vazio, usa o nome da empresa.">
          <input id="general.trade_name_on_documents" name="general.trade_name_on_documents" defaultValue={values["general.trade_name_on_documents"]} maxLength={120} />
        </Field>
        <div className="grid-2">
          <Field label="Primeiro dia da semana nos relatórios" name="general.week_start" state={state}>
            <select id="general.week_start" name="general.week_start" defaultValue={values["general.week_start"]}>
              <option value="monday">Segunda-feira</option>
              <option value="sunday">Domingo</option>
            </select>
          </Field>
          <Field label="Casas decimais em quantidades" name="general.quantity_decimals" state={state} hint="Para produtos vendidos por kg, litro etc.">
            <select id="general.quantity_decimals" name="general.quantity_decimals" defaultValue={String(values["general.quantity_decimals"])}>
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        {deliveries ? <Field
          label="Como a venda chega ao cliente, por padrão"
          name="sales.default_fulfillment"
          state={state}
          hint="Retirada no local não cobra frete nem abre a etapa Entrega. Dá para trocar em cada venda."
        >
          <select id="sales.default_fulfillment" name="sales.default_fulfillment" defaultValue={values["sales.default_fulfillment"]}>
            <option value="pickup">Retirada no local</option>
            <option value="delivery">Entrega</option>
          </select>
        </Field> : <input type="hidden" name="sales.default_fulfillment" value={values["sales.default_fulfillment"]} />}
        {!readOnly && <div className="actions"><SubmitButton>Salvar</SubmitButton></div>}
      </fieldset>
    </form>
  );
}
