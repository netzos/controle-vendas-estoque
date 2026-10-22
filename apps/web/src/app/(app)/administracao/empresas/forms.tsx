"use client";

import { useActionState, useState } from "react";
import { Field, SubmitButton } from "@/components/form";
import { createOrganizationAction, ownerLinkAction } from "./actions";

/** Link pronto para copiar ou mandar no WhatsApp. */
function LinkBox({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-box">
      <input readOnly value={url} aria-label="Link de senha" onFocus={(e) => e.currentTarget.select()} />
      <div className="actions">
        <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>
          {copied ? "Copiado" : "Copiar link"}
        </button>
        <a className="button" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer">
          Mandar no WhatsApp
        </a>
      </div>
    </div>
  );
}

export function CreateOrganizationForm() {
  const [state, action] = useActionState(createOrganizationAction, null);
  const fieldState = state ? { ok: state.ok, message: state.message, fieldErrors: state.fieldErrors } : null;
  return (
    <>
      {state?.message && <div className={`alert ${state.ok ? "success" : "error"}`} role="status">{state.message}</div>}
      {state?.url && (
        <LinkBox
          url={state.url}
          text={`Olá, ${state.ownerName}! A ${state.organizationName} já está no netzsales. Abra este link para criar sua senha e entrar:`}
        />
      )}
      <form action={action} key={state?.ok ? state.url ?? state.organizationName : "form"}>
        <div className="grid-2">
          <Field label="Nome da empresa" name="organizationName" state={fieldState}>
            <input id="organizationName" name="organizationName" required maxLength={120} placeholder="Ex.: Apple Ends" />
          </Field>
          <span />
          <Field label="Nome do dono" name="ownerName" state={fieldState}>
            <input id="ownerName" name="ownerName" required maxLength={120} placeholder="Ex.: Anne" />
          </Field>
          <Field label="E-mail do dono" name="ownerEmail" state={fieldState} hint="É com este e-mail que ele(a) vai entrar.">
            <input id="ownerEmail" name="ownerEmail" type="email" required />
          </Field>
        </div>
        <label style={{ display: "flex", gap: 8, margin: "8px 0" }}>
          <input type="checkbox" name="joinAsOwner" value="1" defaultChecked />
          Eu também entro nessa empresa, para ajudar a configurar (dá para me tirar depois em Ajustes › Usuários)
        </label>
        <div className="actions"><SubmitButton pendingText="Criando...">Criar empresa</SubmitButton></div>
      </form>
    </>
  );
}

export function OwnerLink({ organizationId, firstAccess }: { organizationId: string; firstAccess: boolean }) {
  const [state, action] = useActionState(ownerLinkAction, null);
  return (
    <div>
      {state?.message && <div className={`alert ${state.ok ? "success" : "error"}`}>{state.message}</div>}
      {state?.url && (
        <LinkBox url={state.url} text={`Olá, ${state.name}! Use este link para ${state.firstAccess ? "criar" : "trocar"} sua senha do netzsales:`} />
      )}
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <SubmitButton className="secondary" pendingText="Gerando...">
          {state?.url ? "Gerar outro link" : firstAccess ? "Gerar link para o dono criar a senha" : "Gerar link para o dono trocar a senha"}
        </SubmitButton>
      </form>
    </div>
  );
}
