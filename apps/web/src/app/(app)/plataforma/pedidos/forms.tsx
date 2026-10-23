"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/form";
import { approveAction, rejectAction } from "./actions";

export function RequestDecision({ requestId, name }: { requestId: string; name: string }) {
  const [approved, approve] = useActionState(approveAction, null);
  const [rejected, reject] = useActionState(rejectAction, null);
  const [rejecting, setRejecting] = useState(false);
  const a = approved?.approved;
  if (a) {
    const text =
      `Olá, ${a.name}! Sua conta no netzsales foi aprovada e a ${a.organizationName} já está liberada.\n\n` +
      (a.telegramUrl ? `Para falar com a Netz, sua assistente, no Telegram, toque aqui e depois em Iniciar: ${a.telegramUrl}\n\n` : "") +
      `Para usar o painel no navegador, entre com seu e-mail e a senha que você criou: ${a.loginUrl}`;
    return (
      <div>
        <div className="alert success" role="status">{approved.message}</div>
        <div className="actions">
          <a className="button" href={`https://wa.me/${a.whatsapp ?? ""}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            Avisar {a.name} no WhatsApp
          </a>
          <a className="button secondary" href={`mailto:${a.email}?subject=${encodeURIComponent("Sua conta no netzsales foi aprovada")}&body=${encodeURIComponent(text)}`}>
            Avisar por e-mail
          </a>
        </div>
      </div>
    );
  }
  if (rejected?.ok) return <div className="alert success" role="status">{rejected.message}</div>;
  return (
    <div>
      {approved?.message && <div className="alert error">{approved.message}</div>}
      {rejected?.message && <div className="alert error">{rejected.message}</div>}
      {rejecting ? (
        <form action={reject}>
          <input type="hidden" name="requestId" value={requestId} />
          <div className="field">
            <label htmlFor={`reason-${requestId}`}>Motivo (só você vê)</label>
            <input id={`reason-${requestId}`} name="reason" maxLength={500} />
          </div>
          <div className="actions">
            <SubmitButton className="secondary" pendingText="Recusando...">Confirmar recusa</SubmitButton>
            <button type="button" className="secondary" onClick={() => setRejecting(false)}>Voltar</button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <form action={approve}>
            <input type="hidden" name="requestId" value={requestId} />
            <SubmitButton pendingText="Aprovando...">Aprovar {name}</SubmitButton>
          </form>
          <button type="button" className="secondary" onClick={() => setRejecting(true)}>Recusar</button>
        </div>
      )}
    </div>
  );
}
