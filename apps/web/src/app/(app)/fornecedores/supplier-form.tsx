"use client";

import { useActionState } from "react";
import type { Supplier } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { AddressFields } from "@/components/address-fields";
import { documentLabel, whatsappLabel, zipLabel } from "@/lib/format";
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
        <Field label="WhatsApp" name="whatsapp" state={state} hint="Para pedir mercadoria direto pela conversa.">
          <input id="whatsapp" name="whatsapp" defaultValue={whatsappLabel(supplier?.whatsapp ?? null)} inputMode="tel" maxLength={20} placeholder="(91) 98888-7777" />
        </Field>
        <Field label="Telefone" name="phone" state={state}>
          <input id="phone" name="phone" defaultValue={supplier?.phone ?? ""} inputMode="tel" maxLength={30} />
        </Field>
        <Field label="E-mail" name="email" state={state}>
          <input id="email" name="email" type="email" defaultValue={supplier?.email ?? ""} maxLength={160} />
        </Field>
        <Field label="Prazo de entrega (dias)" name="leadTimeDays" state={state} hint="Prazo padrão. Cada produto pode ter o seu.">
          <input id="leadTimeDays" name="leadTimeDays" defaultValue={supplier?.leadTimeDays ?? ""} inputMode="numeric" maxLength={3} />
        </Field>
      </div>
      <h3 className="form-section">Endereço</h3>
      <AddressFields state={state} initial={supplier ? ({ ...supplier, zipCode: zipLabel(supplier.zipCode) } as never) : undefined} />
      <div className="grid-3">
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
