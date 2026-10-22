"use client";

import { useActionState, useState } from "react";
import type { Category, CustomField, Product, Supplier, Unit } from "@erp/core";
import { ITEM_TYPES, type ItemType } from "@erp/core/labels";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { decimalInput } from "@/lib/format";
import { createProductAction, updateProductAction } from "./actions";

export interface ProductFormOptions {
  categories: Pick<Category, "id" | "name">[];
  units: Pick<Unit, "id" | "code" | "name">[];
  suppliers: Pick<Supplier, "id" | "name">[];
  customFields: CustomField[];
  /** Etapas da lista da empresa (Etapas depois da venda). */
  stepNames: string[];
  canEditPrice: boolean;
}

// Campo personalizado no formulário; o nome "cf_<chave>" volta para a action.
function CustomInput({ field, value, state }: { field: CustomField; value: unknown; state: Parameters<typeof Field>[0]["state"] }) {
  const name = `cf_${field.key}`;
  const label = field.required ? `${field.label} *` : field.label;
  if (field.fieldType === "boolean") {
    return (
      <label className="check">
        <input type="checkbox" name={name} defaultChecked={value === true} />
        {field.label}
      </label>
    );
  }
  return (
    <Field label={label} name={name} state={state}>
      {field.fieldType === "select" ? (
        <select id={name} name={name} defaultValue={typeof value === "string" ? value : ""} required={field.required}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={field.fieldType === "date" ? "date" : "text"}
          inputMode={field.fieldType === "number" ? "decimal" : undefined}
          defaultValue={value == null ? "" : field.fieldType === "number" ? String(value).replace(".", ",") : String(value)}
          required={field.required}
          maxLength={500}
        />
      )}
    </Field>
  );
}

// Etapas depois da venda (entrega, instalação, montagem...). Vão para a action
// como JSON no campo "afterSaleSteps".
function StepsEditor({ initial, suggestions }: { initial: string[]; suggestions: string[] }) {
  const [steps, setSteps] = useState(initial);
  const [draft, setDraft] = useState("");
  const has = (n: string) => steps.some((s) => s.toLowerCase() === n.toLowerCase());
  const add = (n: string) => {
    const name = n.trim();
    if (name.length >= 2 && !has(name) && steps.length < 10) setSteps([...steps, name]);
    setDraft("");
  };
  const move = (i: number, d: number) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setSteps(next);
  };
  return (
    <div className="steps-editor">
      <input type="hidden" name="afterSaleSteps" value={JSON.stringify(steps)} />
      {steps.length === 0 ? (
        <p className="muted">Nenhuma. A venda termina no pagamento.</p>
      ) : (
        <ol className="step-chips">
          {steps.map((s, i) => (
            <li key={s}>
              <span className="step-num">{i + 1}</span>
              {s}
              {i > 0 && <button type="button" className="link" aria-label={`Subir ${s}`} onClick={() => move(i, -1)}>↑</button>}
              <button type="button" className="link" aria-label={`Tirar ${s}`} onClick={() => setSteps(steps.filter((x) => x !== s))}>×</button>
            </li>
          ))}
        </ol>
      )}
      <div className="step-add">
        {suggestions.filter((s) => !has(s)).map((s) => (
          <button type="button" key={s} className="secondary small" onClick={() => add(s)}>+ {s}</button>
        ))}
        <input
          aria-label="Outra etapa"
          placeholder="Outra etapa"
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        {draft.trim().length >= 2 && <button type="button" className="secondary small" onClick={() => add(draft)}>Adicionar</button>}
      </div>
    </div>
  );
}

export function ProductForm({ product, options }: { product?: Product; options: ProductFormOptions }) {
  const [state, action] = useActionState(product ? updateProductAction : createProductAction, null);
  const priceLocked = !options.canEditPrice;
  const [itemType, setItemType] = useState<ItemType>(product?.itemType ?? "stock");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const tracks = ITEM_TYPES[itemType].tracksStock;
  const custom = options.customFields.filter((f) => !f.categoryId || f.categoryId === categoryId);
  return (
    <form action={action}>
      <FormMessage state={state} />
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="itemType" value={itemType} />
      <div className="type-picker" role="radiogroup" aria-label="Tipo do item">
        {(Object.keys(ITEM_TYPES) as ItemType[]).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={itemType === k} className={itemType === k ? "active" : ""} onClick={() => setItemType(k)}>
            <strong>{ITEM_TYPES[k].label}</strong>
            <small>{ITEM_TYPES[k].hint}</small>
          </button>
        ))}
      </div>
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
          <select id="categoryId" name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
        {tracks && (
          <Field label="Estoque mínimo" name="minStock" state={state} hint="Abaixo disso o sistema vai avisar">
            <input id="minStock" name="minStock" defaultValue={decimalInput(product?.minStock, 0)} inputMode="decimal" placeholder="0" />
          </Field>
        )}
        {!product && tracks && (
          <Field label="Estoque inicial" name="initialStock" state={state} hint="Quanto você tem hoje. Pode deixar vazio.">
            <input id="initialStock" name="initialStock" inputMode="decimal" placeholder="0" />
          </Field>
        )}
        {tracks && (
          <Field label="Quando acabar o estoque" name="backorder" state={state} hint="Vendido sem ter, a venda ganha a etapa Encomenda">
            <select id="backorder" name="backorder" defaultValue={product?.backorder === false ? "no" : "yes"}>
              <option value="yes">Continua vendendo por encomenda</option>
              <option value="no">Não deixa vender</option>
            </select>
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
      {custom.length > 0 && (
        <>
          <h3 className="form-section">Informações do item</h3>
          <div className="grid-3">
            {custom.filter((f) => f.fieldType !== "boolean").map((f) => <CustomInput key={f.id} field={f} value={product?.customValues[f.key]} state={state} />)}
          </div>
          {custom.filter((f) => f.fieldType === "boolean").map((f) => <CustomInput key={f.id} field={f} value={product?.customValues[f.key]} state={state} />)}
        </>
      )}
      <h3 className="form-section">Depois da venda</h3>
      <p className="muted small-text">
        O que ainda acontece depois de vender este item, como entrega, instalação ou montagem. Cada venda dele já nasce com essas etapas
        para acompanhar prazo, responsável e custo. Deixe vazio se a venda termina no pagamento.
      </p>
      <StepsEditor initial={product?.afterSaleSteps ?? []} suggestions={options.stepNames} />
      <p className="muted small-text">
        Falta uma etapa? Crie e ajuste prazo, responsável e custo padrão em <a href="/etapas">Etapas depois da venda</a>.
      </p>
      <Field label="Descrição" name="description" state={state}>
        <textarea id="description" name="description" defaultValue={product?.description ?? ""} maxLength={2000} rows={2} />
      </Field>
      <div className="actions"><SubmitButton>{product ? "Salvar" : "Cadastrar produto"}</SubmitButton></div>
    </form>
  );
}
