"use client";

import { useActionState } from "react";
import type { Category, Product, Supplier, Unit } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { decimalInput } from "@/lib/format";
import { createProductAction, updateProductAction } from "./actions";

export interface ProductFormOptions {
  categories: Pick<Category, "id" | "name">[];
  units: Pick<Unit, "id" | "code" | "name">[];
  suppliers: Pick<Supplier, "id" | "name">[];
  canEditPrice: boolean;
}

export function ProductForm({ product, options }: { product?: Product; options: ProductFormOptions }) {
  const [state, action] = useActionState(product ? updateProductAction : createProductAction, null);
  const priceLocked = !options.canEditPrice;
  return (
    <form action={action}>
      <FormMessage state={state} />
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid-3">
        <Field label="Nome" name="name" state={state}>
          <input id="name" name="name" defaultValue={product?.name} required maxLength={160} placeholder="Ex.: Açaí 500 ml" />
        </Field>
        <Field label="Código (SKU)" name="sku" state={state} hint="Código interno do produto">
          <input id="sku" name="sku" defaultValue={product?.sku} required maxLength={40} />
        </Field>
        <Field label="Código de barras" name="barcode" state={state}>
          <input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} inputMode="numeric" maxLength={14} />
        </Field>
        <Field label="Categoria" name="categoryId" state={state}>
          <select id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ""}>
            <option value="">Sem categoria</option>
            {options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Unidade" name="unitId" state={state}>
          <select id="unitId" name="unitId" defaultValue={product?.unitId ?? options.units.find((u) => u.code === "UN")?.id} required>
            {options.units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        </Field>
        <Field label="Fornecedor principal" name="supplierId" state={state}>
          <select id="supplierId" name="supplierId" defaultValue={product?.supplierId ?? ""}>
            <option value="">Nenhum</option>
            {options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Preço de venda (R$)" name="salePrice" state={state} hint={priceLocked ? "Sem permissão para alterar preço" : undefined}>
          <input id="salePrice" name="salePrice" defaultValue={decimalInput(product?.salePrice, 2)} inputMode="decimal" placeholder="0,00" readOnly={priceLocked} />
        </Field>
        <Field label="Custo (R$)" name="costPrice" state={state}>
          <input id="costPrice" name="costPrice" defaultValue={decimalInput(product?.costPrice, 2)} inputMode="decimal" placeholder="0,00" readOnly={priceLocked} />
        </Field>
        <Field label="Estoque mínimo" name="minStock" state={state} hint="Abaixo disso o sistema vai avisar">
          <input id="minStock" name="minStock" defaultValue={decimalInput(product?.minStock, 0)} inputMode="decimal" placeholder="0" />
        </Field>
        {!product && (
          <Field label="Estoque inicial" name="initialStock" state={state} hint="Quanto você tem hoje. Pode deixar vazio.">
            <input id="initialStock" name="initialStock" inputMode="decimal" placeholder="0" />
          </Field>
        )}
        {product && (
          <Field label="Situação" name="status" state={state}>
            <select id="status" name="status" defaultValue={product.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
        )}
      </div>
      <label className="check">
        <input type="checkbox" name="trackStock" defaultChecked={product?.trackStock ?? true} />
        Controlar estoque deste item (desmarque para serviços, taxas e itens feitos na hora)
      </label>
      <Field label="Descrição" name="description" state={state}>
        <textarea id="description" name="description" defaultValue={product?.description ?? ""} maxLength={2000} rows={2} />
      </Field>
      <div className="actions"><SubmitButton>{product ? "Salvar" : "Cadastrar produto"}</SubmitButton></div>
    </form>
  );
}
