"use client";

import { useActionState } from "react";
import type { Supplier } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { documentLabel } from "@/lib/format";
import { createSupplierAction, updateSupplierAction } from "./actions";

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const [state, action] = useActionState(supplier ? updateSupplierAction : createSupplierAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <div className="grid-3">
        <Field label="Razão social ou nome" name="name" state={state}>
          <input id="name" name="name" defaultValue={supplier?.name} required maxLength={160} />
        </Field>
        <Field label="Nome fantasia" name="tradeName" state={state}>
          <input id="tradeName" name="tradeName" defaultValue={supplier?.tradeName ?? ""} maxLength={160} />
        </Field>
        <Field label="CNPJ ou CPF" name="document" state={state}>
          <input id="document" name="document" defaultValue={documentLabel(supplier?.document ?? null)} inputMode="numeric" maxLength={20} />
        </Field>
        <Field label="Contato" name="contactName" state={state}>
          <input id="contactName" name="contactName" defaultValue={supplier?.contactName ?? ""} maxLength={120} />
        </Field>
        <Field label="Telefone / WhatsApp" name="phone" state={state}>
          <input id="phone" name="phone" defaultValue={supplier?.phone ?? ""} inputMode="tel" maxLength={30} />
        </Field>
        <Field label="E-mail" name="email" state={state}>
          <input id="email" name="email" type="email" defaultValue={supplier?.email ?? ""} maxLength={160} />
        </Field>
        <Field label="Cidade" name="city" state={state}>
          <input id="city" name="city" defaultValue={supplier?.city ?? ""} maxLength={80} />
        </Field>
        <Field label="UF" name="state" state={state}>
          <input id="state" name="state" defaultValue={supplier?.state ?? ""} maxLength={2} placeholder="PA" />
        </Field>
        {supplier && (
          <Field label="Situação" name="status" state={state}>
            <select id="status" name="status" defaultValue={supplier.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Observações" name="notes" state={state}>
        <textarea id="notes" name="notes" defaultValue={supplier?.notes ?? ""} maxLength={2000} rows={3} />
      </Field>
      <div className="actions"><SubmitButton>{supplier ? "Salvar" : "Cadastrar fornecedor"}</SubmitButton></div>
    </form>
  );
}
