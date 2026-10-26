"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage, SubmitButton } from "@/components/form";
import { connectTelegramAction, disconnectTelegramAction, telegramOrganizationAction } from "./actions";

export function ConnectTelegram({ again }: { again: boolean }) {
  const [state, action] = useActionState(connectTelegramAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton className={again ? "secondary" : undefined} pendingText="Abrindo o Telegram...">{again ? "Conectar de novo" : "Conectar meu Telegram"}</SubmitButton>
    </form>
  );
}

/** Botão fixo no topo: um clique liga a conta ou abre a conversa com a Netz no Telegram. */
// Logo oficial do Telegram (avião de papel branco no círculo azul).
function TelegramLogo() {
  return (
    <svg viewBox="0 0 240 240" width="22" height="22" aria-hidden="true">
      <circle cx="120" cy="120" r="120" fill="#27A6E5" />
      <path fill="#fff" d="M54 117.6l116.4-44.9c5.4-1.9 10.1 1.3 8.4 9.5l-19.8 93.3c-1.5 6.6-5.4 8.2-10.9 5.1l-30.2-22.3-14.6 14c-1.6 1.6-3 3-6.1 3l2.2-30.7 55.9-50.5c2.4-2.1-.5-3.3-3.8-1.2l-69.1 43.5-29.8-9.3c-6.5-2-6.6-6.5 1.4-9.5z" />
    </svg>
  );
}

function LogoSubmit({ linked }: { linked: boolean }) {
  const { pending } = useFormStatus();
  const label = linked ? "Abrir a Netz no Telegram" : "Conectar o Telegram";
  return (
    <button type="submit" className="telegram-logo" disabled={pending} aria-label={label} title={label}>
      <TelegramLogo />
      {!linked && <span className="telegram-dot" aria-hidden="true" />}
    </button>
  );
}

export function TelegramButton({ linked, large }: { linked: boolean; large?: boolean }) {
  const [state, action] = useActionState(connectTelegramAction, null);
  return (
    <form action={action} className="telegram-button">
      <input type="hidden" name="mode" value={linked ? "open" : "connect"} />
      {large ? (
        <SubmitButton pendingText="Abrindo...">{linked ? "Abrir no Telegram" : "Abrir minha Netz no Telegram"}</SubmitButton>
      ) : (
        // No topo, só a logo do Telegram. Sem a conta ligada, um ponto avisa que falta conectar.
        <LogoSubmit linked={linked} />
      )}
      {state?.message && !state.ok && <span className="telegram-error" role="alert">{state.message}</span>}
    </form>
  );
}

export function DisconnectTelegram() {
  const [state, action] = useActionState(disconnectTelegramAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton className="secondary">Desligar</SubmitButton>
    </form>
  );
}

/** Lista de empresas da pessoa: a que está no Telegram fica marcada, as outras têm "Usar no Telegram". */
export function TelegramOrganizations({ organizations, activeId }: { organizations: { id: string; name: string }[]; activeId: string }) {
  const [state, action] = useActionState(telegramOrganizationAction, null);
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
                <SubmitButton className="secondary small" pendingText="Trocando...">Usar no Telegram</SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
