"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { connectTelegramAction, disconnectTelegramAction } from "./actions";

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
