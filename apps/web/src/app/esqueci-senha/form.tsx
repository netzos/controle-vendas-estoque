"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { requestResetAction } from "./actions";

export function ForgotForm() {
  const [state, action] = useActionState(requestResetAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="E-mail" name="email" state={state}>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <div className="actions">
        <SubmitButton pendingText="Enviando...">Enviar link</SubmitButton>
        <Link href="/login" className="muted">Voltar para entrar</Link>
      </div>
    </form>
  );
}
