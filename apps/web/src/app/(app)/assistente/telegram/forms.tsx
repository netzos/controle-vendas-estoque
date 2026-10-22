"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { connectTelegramAction, disconnectTelegramAction } from "./actions";

export function ConnectTelegram({ again }: { again: boolean }) {
  const [state, action] = useActionState(connectTelegramAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <SubmitButton className={again ? "secondary" : undefined}>{again ? "Conectar de novo" : "Conectar meu Telegram"}</SubmitButton>
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
