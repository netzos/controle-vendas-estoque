"use client";

import { useActionState } from "react";
import type { Customer } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { documentLabel } from "@/lib/format";
import { createCustomerAction, updateCustomerAction } from "./actions";

export function CustomerForm({ customer }: { customer?: Customer }) {
  const [state, action] = useActionState(customer ? updateCustomerAction : createCustomerAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <div className="grid-3">
        <Field label="Tipo" name="kind" state={state}>
          <select id="kind" name="kind" defaultValue={customer?.kind ?? "person"}>
            <option value="person">Pessoa física</option>
            <option value="company">Empresa</option>
          </select>
        </Field>
        <Field label="Nome" name="name" state={state}>
          <input id="name" name="name" defaultValue={customer?.name} required maxLength={160} />
        </Field>
        <Field label="CPF ou CNPJ" name="document" state={state}>
          <input id="document" name="document" defaultValue={documentLabel(customer?.document ?? null)} inputMode="numeric" maxLength={20} />
        </Field>
        <Field label="Telefone / WhatsApp" name="phone" state={state}>
          <input id="phone" name="phone" defaultValue={customer?.phone ?? ""} inputMode="tel" maxLength={30} />
        </Field>
        <Field label="E-mail" name="email" state={state}>
          <input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} maxLength={160} />
        </Field>
        <Field label="Cidade" name="city" state={state}>
          <input id="city" name="city" defaultValue={customer?.city ?? ""} maxLength={80} />
        </Field>
        <Field label="UF" name="state" state={state}>
          <input id="state" name="state" defaultValue={customer?.state ?? ""} maxLength={2} placeholder="SP" />
        </Field>
        {customer && (
          <Field label="Situação" name="status" state={state}>
            <select id="status" name="status" defaultValue={customer.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Observações" name="notes" state={state}>
        <textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} maxLength={2000} rows={3} />
      </Field>
      <div className="actions"><SubmitButton>{customer ? "Salvar" : "Cadastrar cliente"}</SubmitButton></div>
    </form>
  );
}
