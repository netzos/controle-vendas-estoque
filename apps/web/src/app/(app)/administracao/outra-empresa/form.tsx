"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { anotherOrganizationAction } from "./actions";

export function AnotherOrganizationForm() {
  const [state, action] = useActionState(anotherOrganizationAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="Nome da empresa nova" name="organizationName" state={state}>
        <input id="organizationName" name="organizationName" required maxLength={120} />
      </Field>
      <Field label="O que ela vende (opcional)" name="business" state={state}>
        <textarea id="business" name="business" maxLength={500} rows={3} />
      </Field>
      <div className="actions"><SubmitButton pendingText="Enviando...">Pedir a empresa nova</SubmitButton></div>
    </form>
  );
}
