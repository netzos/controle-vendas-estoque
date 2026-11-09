"use client";

import { useActionState, useEffect, useState } from "react";
import { shrinkPhoto } from "@/lib/photo";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { receivePaymentAction } from "./actions";

const METHODS = [
  { key: "pix", label: "Pix" },
  { key: "cash", label: "Dinheiro" },
  { key: "debit", label: "Débito" },
  { key: "credit", label: "Crédito" },
  { key: "other", label: "Outro" },
];

/**
 * Receber o que falta de uma venda com pagamento parcial (ou tudo, se ficou a receber).
 * Na venda parcelada, installmentId diz qual parcela recebe primeiro; o que passar vai para as seguintes.
 */
export function ReceivePaymentForm({ saleId, open, installmentId, hint, onDone, withReceipt = true }: { saleId: string; open: string; installmentId?: string; hint?: string; onDone?: () => void; withReceipt?: boolean }) {
  const [state, action] = useActionState(receivePaymentAction, null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);
  const openLabel = Number(open).toFixed(2).replace(".", ",");
  return (
    <form action={action} className="receive-form">
      <FormMessage state={state} />
      <input type="hidden" name="saleId" value={saleId} />
      {installmentId && <input type="hidden" name="installmentId" value={installmentId} />}
      <div className="grid-3">
        <Field label="Valor recebido (R$)" name="amount" state={state} hint={hint ?? `Falta ${openLabel}`}>
          <input id="amount" name="amount" inputMode="decimal" defaultValue={openLabel} required key={open} />
        </Field>
        <Field label="Forma" name="method" state={state}>
          <select id="method" name="method" defaultValue="pix">
            {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Observação" name="notes" state={state}>
          <input id="notes" name="notes" maxLength={300} placeholder="Opcional" />
        </Field>
      </div>
      {withReceipt && (
        <div className="field">
          <label htmlFor={`receipt-${saleId}`}>Comprovante (opcional)</label>
          <input
            id={`receipt-${saleId}`}
            name="receipt"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={async (e) => {
              // Foto do celular é reduzida aqui (4 MB viram ~300 KB); PDF vai como está.
              const input = e.currentTarget;
              const f = input.files?.[0];
              if (!f || f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return;
              setReading(true);
              try {
                const { blob } = await shrinkPhoto(f, 2000);
                const dt = new DataTransfer();
                dt.items.add(new File([blob], f.name.replace(/\.\w+$/, "") + (blob.type === "image/webp" ? ".webp" : ".jpg"), { type: blob.type }));
                input.files = dt.files;
              } catch {
                // Sem redução: segue o arquivo original.
              }
              setReading(false);
            }}
          />
          <span className="muted small-text">Foto do cupom, print do Pix ou PDF. Fica guardado na venda e o sistema confere se o valor bate.</span>
        </div>
      )}
      <SubmitButton pendingText="Registrando..." disabled={reading}>Registrar recebimento</SubmitButton>
    </form>
  );
}
