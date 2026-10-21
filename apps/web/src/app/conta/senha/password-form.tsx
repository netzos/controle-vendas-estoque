"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null);
  if (state?.ok) {
    return (
      <>
        <FormMessage state={state} />
        <Link className="button" href="/">Continuar</Link>
      </>
    );
  }
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="Senha atual" name="currentPassword" state={state}>
        <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="Nova senha" name="newPassword" state={state} hint="Mínimo de 10 caracteres.">
        <input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <Field label="Confirme a nova senha" name="confirm" state={state}>
        <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <div className="actions">
        <SubmitButton>Alterar senha</SubmitButton>
      </div>
    </form>
  );
}
