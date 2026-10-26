"use client";

import { useActionState } from "react";
import type { CostType } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { cancelCostAction, createCostAction, createCostTypeAction, setCostPartAction, updateCostTypeAction } from "./actions";

type Option = { id: string; name: string };

export function CostForm({ types, products, suppliers, today }: { types: Option[]; products: Option[]; suppliers: Option[]; today: string }) {
  const [state, action] = useActionState(createCostAction, null);
  return (
    <form action={action} key={state?.ok ? String(Math.random()) : "form"}>
      <FormMessage state={state} />
      <div className="grid-3">
        <Field label="Custo" name="description" state={state} hint="O nome do gasto, do jeito que você fala.">
          <input id="description" name="description" required maxLength={300} placeholder="Ex.: Conta de luz de outubro" />
        </Field>
        <Field label="Valor (R$)" name="amount" state={state}>
          <input id="amount" name="amount" inputMode="decimal" required placeholder="0,00" />
        </Field>
        <Field label="Data" name="incurredOn" state={state}>
          <input id="incurredOn" name="incurredOn" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Grupo" name="costTypeId" state={state} hint="Para somar gastos parecidos (Aluguel, Frete, Energia...).">
          <select id="costTypeId" name="costTypeId" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Só de um produto? (opcional)" name="productId" state={state} hint="Ex.: frete que veio só com um produto. Gastos da empresa toda ficam sem produto.">
          <select id="productId" name="productId" defaultValue="">
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Fornecedor (opcional)" name="supplierId" state={state}>
          <select id="supplierId" name="supplierId" defaultValue="">
            <option value="">—</option>
            {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="actions"><SubmitButton>Lançar custo</SubmitButton></div>
    </form>
  );
}

export function CancelCostButton({ id }: { id: string }) {
  const [state, action] = useActionState(cancelCostAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {state && !state.ok ? <span className="warn-text">{state.message}</span> : <SubmitButton className="secondary small" pendingText="...">Cancelar</SubmitButton>}
    </form>
  );
}

export function CostTypeForm({ type }: { type?: CostType }) {
  const [state, action] = useActionState(type ? updateCostTypeAction : createCostTypeAction, null);
  const p = type ? `t-${type.id}-` : "new-";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {type && <input type="hidden" name="id" value={type.id} />}
      <div className="grid-2">
        <Field label="Nome" name="name" state={state}>
          <input id={`${p}name`} name="name" defaultValue={type?.name} required maxLength={60} placeholder="Ex.: Energia, Aluguel, Frete" />
        </Field>
        {type && (
          <Field label="Situação" name="status" state={state}>
            <select id={`${p}status`} name="status" defaultValue={type.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <div className="actions"><SubmitButton>{type ? "Salvar" : "Criar tipo"}</SubmitButton></div>
    </form>
  );
}

export function CostPartForm({ products, types, today, productId }: { products: Option[]; types: Option[]; today: string; productId?: string }) {
  const [state, action] = useActionState(setCostPartAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <div className="grid-3">
        <Field label="Produto" name="productId" state={state}>
          <select id="productId" name="productId" required defaultValue={productId ?? ""}>
            <option value="" disabled>Escolha</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Parte do custo" name="costTypeId" state={state} hint="Ex.: Matéria-prima, Mão de obra, Embalagem.">
          <select id="costTypeId" name="costTypeId" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Valor por unidade (R$)" name="amount" state={state}>
          <input id="amount" name="amount" inputMode="decimal" required placeholder="0,00" />
        </Field>
        <Field label="Vale a partir de" name="validFrom" state={state}>
          <input id="validFrom" name="validFrom" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Observação" name="notes" state={state}>
          <input id="notes" name="notes" maxLength={300} placeholder="Ex.: novo preço do fornecedor" />
        </Field>
      </div>
      <div className="actions"><SubmitButton>Salvar valor</SubmitButton></div>
    </form>
  );
}
