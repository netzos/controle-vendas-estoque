"use client";

import { useActionState } from "react";
import type { Branch } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { createBranchAction, updateBranchAction } from "./actions";

export function BranchForm({ branch }: { branch?: Branch }) {
  const [state, action] = useActionState(branch ? updateBranchAction : createBranchAction, null);
  const p = branch ? `b-${branch.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {branch && <input type="hidden" name="id" value={branch.id} />}
      <div className="grid-2">
        <Field label="Nome" name="name" state={state}>
          <input id={`${p}name`} name="name" defaultValue={branch?.name} required maxLength={120} />
        </Field>
        <Field label="Código" name="code" state={state} hint="Ex.: CENTRO, LOJA2">
          <input id={`${p}code`} name="code" defaultValue={branch?.code} required maxLength={20} />
        </Field>
        <Field label="CNPJ" name="document" state={state}>
          <input id={`${p}document`} name="document" defaultValue={branch?.document ?? ""} maxLength={20} />
        </Field>
        {branch && !branch.isHeadquarters && (
          <Field label="Situação" name="status" state={state}>
            <select id={`${p}status`} name="status" defaultValue={branch.status}>
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </select>
          </Field>
        )}
      </div>
      <div className="actions"><SubmitButton>{branch ? "Salvar" : "Cadastrar filial"}</SubmitButton></div>
    </form>
  );
}
