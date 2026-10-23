"use client";

import { useActionState } from "react";
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
export function TelegramButton({ linked, large }: { linked: boolean; large?: boolean }) {
  const [state, action] = useActionState(connectTelegramAction, null);
  return (
    <form action={action} className="telegram-button">
      <input type="hidden" name="mode" value={linked ? "open" : "connect"} />
      <SubmitButton className={large ? undefined : linked ? "secondary small" : "small"} pendingText="Abrindo...">
        {linked ? "Abrir no Telegram" : large ? "Abrir minha Netz no Telegram" : "Conectar Telegram"}
      </SubmitButton>
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
