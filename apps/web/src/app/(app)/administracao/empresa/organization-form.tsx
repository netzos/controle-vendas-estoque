"use client";

import { useActionState } from "react";
import type { Organization } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { updateOrganizationAction } from "./actions";

export function OrganizationForm({ org, timezones, readOnly }: { org: Organization; timezones: string[]; readOnly: boolean }) {
  const [state, action] = useActionState(updateOrganizationAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label="Nome" name="name" state={state}>
          <input id="name" name="name" defaultValue={org.name} required maxLength={120} />
        </Field>
        <div className="grid-2">
          <Field label="Razão social" name="legalName" state={state}>
            <input id="legalName" name="legalName" defaultValue={org.legalName ?? ""} maxLength={200} />
          </Field>
          <Field label="CNPJ ou CPF" name="document" state={state}>
            <input id="document" name="document" defaultValue={org.document ?? ""} maxLength={20} />
          </Field>
        </div>
        <Field label="Fuso horário" name="timezone" state={state} hint="Define o horário de lembretes, relatórios e vencimentos.">
          <select id="timezone" name="timezone" defaultValue={org.timezone}>
            {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="Moeda" name="currency">
          <input id="currency" value={org.currency} disabled readOnly />
        </Field>
        {!readOnly && <div className="actions"><SubmitButton>Salvar</SubmitButton></div>}
      </fieldset>
    </form>
  );
}
