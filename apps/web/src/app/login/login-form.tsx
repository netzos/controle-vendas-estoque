"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="E-mail" name="email" state={state}>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Senha" name="password" state={state}>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="actions">
        <SubmitButton pendingText="Entrando...">Entrar</SubmitButton>
        <Link href="/esqueci-senha" className="muted">Esqueci minha senha</Link>
      </div>
    </form>
  );
}
