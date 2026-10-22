"use client";

import { useActionState, useState } from "react";
import type { RemovableKind } from "@erp/core";
import { FormMessage, SubmitButton } from "@/components/form";
import { removeRecordAction } from "@/app/(app)/remove-actions";

/** Botão Excluir com confirmação. Com histórico, o sistema desativa em vez de apagar. */
export function RemoveRecord({ kind, id, name, back }: { kind: RemovableKind; id: string; name: string; back?: string }) {
  const [state, action] = useActionState(removeRecordAction, null);
  const [asking, setAsking] = useState(false);
  return (
    <div className="remove-record">
      <FormMessage state={state} />
      {asking ? (
        <form action={action} className="remove-confirm">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          {back && <input type="hidden" name="back" value={back} />}
          <span>Excluir <b>{name}</b>? Se já tiver histórico, ele(a) será desativado(a) em vez de apagado(a).</span>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setAsking(false)}>Não</button>
            <SubmitButton className="danger" pendingText="Excluindo...">Sim, excluir</SubmitButton>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary danger-text" onClick={() => setAsking(true)}>Excluir</button>
      )}
    </div>
  );
}

/** Aviso que volta da exclusão (?aviso=...). */
export function Notice({ text }: { text?: string }) {
  if (!text) return null;
  return <div className="alert success" role="status">{text}</div>;
}
