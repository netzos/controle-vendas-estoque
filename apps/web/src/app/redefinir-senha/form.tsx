"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <Field label="Nova senha" name="newPassword" state={state} hint="Pelo menos 10 caracteres.">
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} autoFocus />
      </Field>
      <Field label="Repita a senha" name="confirm" state={state}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <div className="actions"><SubmitButton>Salvar senha</SubmitButton></div>
    </form>
  );
}
