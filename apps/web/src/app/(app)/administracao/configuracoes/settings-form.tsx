"use client";

import { useActionState } from "react";
import type { SettingValues } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { updateSettingsAction } from "./actions";

export function SettingsForm({ values, readOnly }: { values: SettingValues; readOnly: boolean }) {
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
        {!readOnly && <div className="actions"><SubmitButton>Salvar</SubmitButton></div>}
      </fieldset>
    </form>
  );
}
