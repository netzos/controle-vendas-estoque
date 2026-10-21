"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { setupAction } from "./actions";

export function SetupForm({ timezones }: { timezones: string[] }) {
  const [state, action] = useActionState(setupAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <h2>Empresa</h2>
      <Field label="Nome da empresa" name="organizationName" state={state}>
        <input id="organizationName" name="organizationName" required maxLength={120} />
      </Field>
      <div className="grid-2">
        <Field label="Razão social" name="legalName" state={state}>
          <input id="legalName" name="legalName" maxLength={200} />
        </Field>
        <Field label="CNPJ ou CPF" name="document" state={state}>
          <input id="document" name="document" maxLength={20} />
        </Field>
      </div>
      <Field label="Fuso horário" name="timezone" state={state} hint="Usado em lembretes, relatórios e vencimentos.">
        <select id="timezone" name="timezone" defaultValue="America/Sao_Paulo">
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </Field>
      <h2>Proprietário</h2>
      <Field label="Seu nome" name="name" state={state}>
        <input id="name" name="name" required maxLength={120} autoComplete="name" />
      </Field>
      <Field label="E-mail" name="email" state={state}>
        <input id="email" name="email" type="email" required autoComplete="username" />
      </Field>
      <div className="grid-2">
        <Field label="Senha" name="password" state={state} hint="Mínimo de 10 caracteres.">
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Confirme a senha" name="passwordConfirm" state={state}>
          <input id="passwordConfirm" name="passwordConfirm" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
      </div>
      <div className="actions">
        <SubmitButton pendingText="Configurando...">Criar empresa e entrar</SubmitButton>
      </div>
    </form>
  );
}
