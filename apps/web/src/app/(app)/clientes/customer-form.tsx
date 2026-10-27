"use client";

import { useActionState } from "react";
import type { Branch, Customer } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { AddressFields } from "@/components/address-fields";
import { PhotoPicker } from "@/components/photo-picker";
import { documentLabel, zipLabel } from "@/lib/format";
import { createCustomerAction, updateCustomerAction } from "./actions";

export function CustomerForm({ customer, branches = [] }: { customer?: Customer; branches?: Pick<Branch, "id" | "name">[] }) {
  const [state, action] = useActionState(customer ? updateCustomerAction : createCustomerAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <PhotoPicker name="photo" round current={customer?.photoId ? `/clientes/foto/${customer.photoId}` : null} />
      <div className="grid-3">
        <Field label="Tipo" name="kind" state={state}>
          <select id="kind" name="kind" defaultValue={customer?.kind ?? "person"}>
            <option value="person">Pessoa física</option>
            <option value="company">Pessoa jurídica</option>
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
        <Field label="Código do cliente" name="code" state={state} hint="O código que você já usava, se tiver">
          <input id="code" name="code" defaultValue={customer?.code ?? ""} maxLength={40} />
        </Field>
        <Field label="Cliente desde" name="customerSince" state={state}>
          <input id="customerSince" name="customerSince" type="date" defaultValue={customer?.customerSince ?? ""} />
        </Field>
        {branches.length > 1 && (
          <Field label="Filial" name="branchId" state={state}>
            <select id="branchId" name="branchId" defaultValue={customer?.branchId ?? ""}>
              <option value="">Todas as filiais</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        {customer && (
          <Field label="Situação" name="status" state={state}>
            <select id="status" name="status" defaultValue={customer.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <h3 className="form-section">Endereço</h3>
      <AddressFields
        state={state}
        initial={customer ? { ...customer, zipCode: zipLabel(customer.zipCode) } as never : undefined}
      />
      <Field label="Observações" name="notes" state={state}>
        <textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} maxLength={2000} rows={3} />
      </Field>
      <div className="actions"><SubmitButton>{customer ? "Salvar" : "Cadastrar cliente"}</SubmitButton></div>
    </form>
  );
}
