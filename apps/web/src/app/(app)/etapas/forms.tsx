"use client";

import { useActionState } from "react";
import type { StepType } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { decimalInput } from "@/lib/format";
import { createStepTypeAction, updateStepTypeAction } from "./actions";

export function StepTypeForm({ type }: { type?: StepType }) {
  const [state, action] = useActionState(type ? updateStepTypeAction : createStepTypeAction, null);
  const p = type ? `s-${type.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {type && <input type="hidden" name="id" value={type.id} />}
      <div className="grid-3">
        <Field label="Nome" name="name" state={state} hint={type && type.products > 0 ? "Renomear muda nos produtos também" : undefined}>
          <input id={`${p}name`} name="name" defaultValue={type?.name} required maxLength={60} placeholder="Ex.: Pintura" />
        </Field>
        <Field label="Prazo padrão (dias)" name="defaultDays" state={state} hint="Contados do dia da venda. Vazio = sem prazo">
          <input id={`${p}days`} name="defaultDays" type="number" min={0} max={365} defaultValue={type?.defaultDays ?? ""} placeholder="Ex.: 3" />
        </Field>
        <Field label="Responsável padrão" name="defaultResponsible" state={state}>
          <input id={`${p}resp`} name="defaultResponsible" defaultValue={type?.defaultResponsible ?? ""} maxLength={120} placeholder="Ex.: João instalador" />
        </Field>
        <Field label="Custo padrão (R$)" name="defaultCost" state={state} hint="Quanto a etapa custa para você. Entra em Custos">
          <input id={`${p}cost`} name="defaultCost" inputMode="decimal" defaultValue={decimalInput(type?.defaultCost ?? undefined, 2)} placeholder="0,00" />
        </Field>
        <Field label="Descrição" name="description" state={state}>
          <input id={`${p}desc`} name="description" defaultValue={type?.description ?? ""} maxLength={300} placeholder="O que acontece nesta etapa" />
        </Field>
        {type && (
          <Field label="Situação" name="status" state={state}>
            <select id={`${p}status`} name="status" defaultValue={type.status}>
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </select>
          </Field>
        )}
      </div>
      <div className="actions"><SubmitButton>{type ? "Salvar" : "Criar etapa"}</SubmitButton></div>
    </form>
  );
}
