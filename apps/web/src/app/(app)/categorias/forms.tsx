"use client";

import { useActionState } from "react";
import type { Category, Unit } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { createCategoryAction, createUnitAction, updateCategoryAction, updateUnitAction } from "./actions";

function StatusField({ id, value, state }: { id: string; value: string; state: Parameters<typeof Field>[0]["state"] }) {
  return (
    <Field label="Situação" name="status" state={state}>
      <select id={id} name="status" defaultValue={value}>
        <option value="active">Ativa</option>
        <option value="inactive">Inativa</option>
      </select>
    </Field>
  );
}

export function CategoryForm({ category }: { category?: Category }) {
  const [state, action] = useActionState(category ? updateCategoryAction : createCategoryAction, null);
  const p = category ? `c-${category.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {category && <input type="hidden" name="id" value={category.id} />}
      <div className="grid-2">
        <Field label="Nome" name="name" state={state}>
          <input id={`${p}name`} name="name" defaultValue={category?.name} required maxLength={80} placeholder="Ex.: Bebidas" />
        </Field>
        {category && <StatusField id={`${p}status`} value={category.status} state={state} />}
      </div>
      <div className="actions"><SubmitButton>{category ? "Salvar" : "Criar categoria"}</SubmitButton></div>
    </form>
  );
}

export function UnitForm({ unit }: { unit?: Unit }) {
  const [state, action] = useActionState(unit ? updateUnitAction : createUnitAction, null);
  const p = unit ? `u-${unit.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {unit && <input type="hidden" name="id" value={unit.id} />}
      <div className="grid-3">
        <Field label="Sigla" name="code" state={state} hint="Ex.: UN, KG, CX">
          <input id={`${p}code`} name="code" defaultValue={unit?.code} required maxLength={6} />
        </Field>
        <Field label="Nome" name="name" state={state}>
          <input id={`${p}name`} name="name" defaultValue={unit?.name} required maxLength={40} />
        </Field>
        <Field label="Casas decimais na quantidade" name="decimals" state={state} hint="0 para unidade, 3 para quilo">
          <select id={`${p}decimals`} name="decimals" defaultValue={String(unit?.decimals ?? 0)}>
            <option value="0">0 (1, 2, 3)</option>
            <option value="1">1 (1,5)</option>
            <option value="2">2 (1,25)</option>
            <option value="3">3 (0,750)</option>
          </select>
        </Field>
        {unit && <StatusField id={`${p}status`} value={unit.status} state={state} />}
      </div>
      <div className="actions"><SubmitButton>{unit ? "Salvar" : "Criar unidade"}</SubmitButton></div>
    </form>
  );
}
