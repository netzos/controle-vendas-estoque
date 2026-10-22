"use client";

import { useActionState, useState } from "react";
import type { CustomField } from "@erp/core";
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from "@erp/core/labels";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { createCustomFieldAction, updateCustomFieldAction } from "./actions";

export function CustomFieldForm({ field, categories }: { field?: CustomField; categories: { id: string; name: string }[] }) {
  const [state, action] = useActionState(field ? updateCustomFieldAction : createCustomFieldAction, null);
  const [type, setType] = useState<CustomFieldType>(field?.fieldType ?? "text");
  const p = field ? `f-${field.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {field && <input type="hidden" name="id" value={field.id} />}
      <div className="grid-3">
        <Field label="Nome do campo" name="label" state={state}>
          <input id={`${p}label`} name="label" defaultValue={field?.label} required maxLength={60} placeholder="Ex.: IMEI, Cor, Safra" />
        </Field>
        <Field label="Tipo" name="fieldType" state={state} hint={field ? "O tipo não muda depois de criado." : undefined}>
          <select id={`${p}fieldType`} name="fieldType" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} disabled={!!field}>
            {Object.entries(CUSTOM_FIELD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Vale para" name="categoryId" state={state}>
          <select id={`${p}categoryId`} name="categoryId" defaultValue={field?.categoryId ?? ""}>
            <option value="">Todos os itens</option>
            {categories.map((c) => <option key={c.id} value={c.id}>Só a categoria {c.name}</option>)}
          </select>
        </Field>
        {type === "select" && (
          <Field label="Opções" name="options" state={state} hint="Separe por vírgula.">
            <input id={`${p}options`} name="options" defaultValue={field?.options.join(", ")} placeholder="Ex.: Preto, Branco, Azul" />
          </Field>
        )}
        <Field label="Ordem" name="position" state={state} hint="Menor aparece primeiro.">
          <input id={`${p}position`} name="position" inputMode="numeric" defaultValue={field?.position ?? 0} maxLength={3} />
        </Field>
        {field && (
          <Field label="Situação" name="status" state={state}>
            <select id={`${p}status`} name="status" defaultValue={field.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <label className="check">
        <input type="checkbox" name="required" defaultChecked={field?.required ?? false} />
        Obrigatório no cadastro
      </label>
      <div className="actions"><SubmitButton>{field ? "Salvar" : "Criar campo"}</SubmitButton></div>
    </form>
  );
}
