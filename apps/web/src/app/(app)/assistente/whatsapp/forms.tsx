"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage, SubmitButton } from "@/components/form";
import { connectWhatsAppAction, disconnectWhatsAppAction, whatsappOrganizationAction } from "./actions";

export function ConnectWhatsApp({ again }: { again: boolean }) {
  const [state, action] = useActionState(connectWhatsAppAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton className={again ? "secondary" : undefined} pendingText="Abrindo o WhatsApp...">{again ? "Ligar de novo" : "Ligar meu WhatsApp"}</SubmitButton>
    </form>
  );
}

// Logo do WhatsApp (telefone branco no balão verde).
function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path
        fill="#fff"
        d="M16 6.5a9.4 9.4 0 0 0-8.1 14.2L6.6 25.4l4.8-1.3A9.4 9.4 0 1 0 16 6.5zm0 17.2a7.8 7.8 0 0 1-4-1.1l-.3-.2-2.8.8.8-2.8-.2-.3A7.8 7.8 0 1 1 16 23.7zm4.3-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.4-.3z"
      />
    </svg>
  );
}

function LogoSubmit({ linked }: { linked: boolean }) {
  const { pending } = useFormStatus();
  const label = linked ? "Abrir a Netz no WhatsApp" : "Ligar o WhatsApp";
  return (
    <button type="submit" className="telegram-logo" disabled={pending} aria-label={label} title={label}>
      <WhatsAppLogo />
      {!linked && <span className="telegram-dot" aria-hidden="true" />}
    </button>
  );
}

/** Botão fixo no topo: um clique abre a conversa com a Netz no WhatsApp (com o código, se ainda não ligou). */
export function WhatsAppButton({ linked, large }: { linked: boolean; large?: boolean }) {
  const [state, action] = useActionState(connectWhatsAppAction, null);
  return (
    <form action={action} className="telegram-button">
      <input type="hidden" name="mode" value={linked ? "open" : "connect"} />
      {large ? <SubmitButton pendingText="Abrindo...">{linked ? "Abrir no WhatsApp" : "Abrir minha Netz no WhatsApp"}</SubmitButton> : <LogoSubmit linked={linked} />}
      {state?.message && !state.ok && <span className="telegram-error" role="alert">{state.message}</span>}
    </form>
  );
}

export function DisconnectWhatsApp() {
  const [state, action] = useActionState(disconnectWhatsAppAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton className="secondary">Desligar</SubmitButton>
    </form>
  );
}

export function WhatsAppOrganizations({ organizations, activeId }: { organizations: { id: string; name: string }[]; activeId: string }) {
  const [state, action] = useActionState(whatsappOrganizationAction, null);
  return (
    <div>
      <FormMessage state={state} />
      <ul className="org-choice">
        {organizations.map((o) => (
          <li key={o.id} className={o.id === activeId ? "active" : undefined}>
            <span>{o.name}</span>
            {o.id === activeId ? (
              <span className="tag ok">Netz trabalhando aqui</span>
            ) : (
              <form action={action}>
                <input type="hidden" name="organizationId" value={o.id} />
                <SubmitButton className="secondary small" pendingText="Trocando...">Usar no WhatsApp</SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
