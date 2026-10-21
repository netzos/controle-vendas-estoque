"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { quantity } from "@/lib/format";
import { createMovementAction } from "./actions";

type Kind = "in" | "out" | "adjust";

const KINDS: { key: Kind; label: string; qty: string; button: string }[] = [
  { key: "in", label: "Entrada", qty: "Quantidade que entrou", button: "Lançar entrada" },
  { key: "out", label: "Saída / perda", qty: "Quantidade que saiu", button: "Lançar saída" },
  { key: "adjust", label: "Ajuste (contagem)", qty: "Saldo contado agora", button: "Ajustar saldo" },
];

export function MovementForm({
  products,
  defaultKind,
  defaultProductId,
}: {
  products: { id: string; name: string; unitCode: string; stock: string; cost: string }[];
  defaultKind: Kind;
  defaultProductId?: string;
}) {
  const [state, action] = useActionState(createMovementAction, null);
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [productId, setProductId] = useState(defaultProductId ?? "");
  const current = KINDS.find((k) => k.key === kind)!;
  const product = products.find((p) => p.id === productId);

  if (products.length === 0) return <p className="chart-empty">Nenhum produto com controle de estoque. Ative em Catálogo › Produtos.</p>;

  return (
    <form action={action}>
      <input type="hidden" name="kind" value={kind} />
      <div className="card-head">
        <nav className="segmented" aria-label="Tipo de lançamento">
          {KINDS.map((k) => (
            <button type="button" key={k.key} className={k.key === kind ? "active" : ""} onClick={() => setKind(k.key)}>{k.label}</button>
          ))}
        </nav>
      </div>
      <FormMessage state={state} />
      <div className="grid-3">
        <Field label="Produto" name="productId" state={state} hint={product ? `Saldo atual: ${quantity(product.stock)} ${product.unitCode}` : undefined}>
          <select id="productId" name="productId" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="" disabled>Escolha o produto</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={current.qty} name="quantity" state={state}>
          <input id="quantity" name="quantity" inputMode="decimal" required placeholder="0" />
        </Field>
        {kind === "in" ? (
          <Field label="Custo unitário (R$)" name="unitCost" state={state} hint="Opcional. Atualiza o custo médio do produto.">
            <input id="unitCost" name="unitCost" inputMode="decimal" placeholder="0,00" />
          </Field>
        ) : (
          <Field label="Observação" name="notes" state={state}>
            <input id="notes" name="notes" maxLength={500} placeholder={kind === "out" ? "Ex.: venceu, quebrou" : "Ex.: inventário do mês"} />
          </Field>
        )}
      </div>
      {kind === "in" && (
        <Field label="Observação" name="notes" state={state}>
          <input id="notes" name="notes" maxLength={500} placeholder="Ex.: nota 1234 do fornecedor" />
        </Field>
      )}
      <div className="actions"><SubmitButton>{current.button}</SubmitButton></div>
    </form>
  );
}
