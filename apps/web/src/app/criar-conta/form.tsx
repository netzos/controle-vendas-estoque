"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { signupAction } from "./actions";

export function SignupForm() {
  const [state, action] = useActionState(signupAction, null);
  if (state?.ok) {
    return (
      <div>
        <div className="alert success" role="status">
          Recebemos seu pedido. Vamos analisar e avisar pelo WhatsApp ou e-mail assim que sua conta for liberada.
        </div>
        <p className="muted">Depois da aprovação, é só entrar com o e-mail e a senha que você acabou de criar.</p>
        <div className="actions"><Link href="/login" className="button secondary">Voltar para o login</Link></div>
      </div>
    );
  }
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="Seu nome" name="name" state={state}>
        <input id="name" name="name" required maxLength={120} autoComplete="name" autoFocus />
      </Field>
      <Field label="E-mail" name="email" state={state} hint="É com ele que você vai entrar.">
        <input id="email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="WhatsApp (com DDD)" name="whatsapp" state={state} hint="Para avisarmos quando a conta for liberada.">
        <input id="whatsapp" name="whatsapp" type="tel" maxLength={30} autoComplete="tel" placeholder="(91) 99999-9999" />
      </Field>
      <Field label="Nome da empresa" name="organizationName" state={state}>
        <input id="organizationName" name="organizationName" required maxLength={120} autoComplete="organization" />
      </Field>
      <Field label="O que você vende? (opcional)" name="business" state={state}>
        <input id="business" name="business" maxLength={500} placeholder="Ex.: eletrônicos, relógios, açaí" />
      </Field>
      <Field label="Crie uma senha" name="password" state={state} hint="Mínimo de 10 caracteres.">
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <Field label="Repita a senha" name="passwordConfirm" state={state}>
        <input id="passwordConfirm" name="passwordConfirm" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
      <div className="actions">
        <SubmitButton pendingText="Enviando...">Pedir minha conta</SubmitButton>
        <Link href="/login" className="muted">Já tenho conta</Link>
      </div>
    </form>
  );
}
