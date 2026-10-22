"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import {
  billingAction,
  createOrganizationAction,
  deleteOrganizationAction,
  leaveSupportAction,
  organizationKindAction,
  organizationNotesAction,
  organizationStatusAction,
  ownerLinkAction,
} from "./actions";

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
            <input id="organizationName" name="organizationName" required maxLength={120} placeholder="Ex.: Loja da Maria" />
          </Field>
          <span />
          <Field label="Nome do dono" name="ownerName" state={fieldState}>
            <input id="ownerName" name="ownerName" required maxLength={120} placeholder="Ex.: Maria" />
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

/** Suspender (ninguém entra, os dados ficam) ou reativar a empresa. */
export function OrganizationStatus({ organizationId, name, status }: { organizationId: string; name: string; status: "active" | "suspended" }) {
  const [state, action] = useActionState(organizationStatusAction, null);
  const suspend = status === "active";
  return (
    <form
      action={action}
      className="remove-record"
      onSubmit={(e) => {
        if (suspend && !window.confirm(`Suspender ${name}? Ninguém da empresa vai conseguir entrar até você reativar.`)) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="status" value={suspend ? "suspended" : "active"} />
      <SubmitButton className="secondary" pendingText="Salvando...">{suspend ? "Suspender empresa" : "Reativar empresa"}</SubmitButton>
    </form>
  );
}

/** Link de senha para uma pessoa da empresa (suporte). Mostra o link logo abaixo do botão. */
export function MemberLink({ organizationId, membershipId, name, firstAccess }: { organizationId: string; membershipId: string; name: string; firstAccess: boolean }) {
  const [state, action] = useActionState(ownerLinkAction, null);
  return (
    <div className="member-link">
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="membershipId" value={membershipId} />
        <SubmitButton className="secondary small" pendingText="Gerando...">{firstAccess ? "Link de primeiro acesso" : "Link de nova senha"}</SubmitButton>
      </form>
      {state && !state.ok && <span className="error">{state.message}</span>}
      {state?.url && (
        <LinkBox url={state.url} text={`Olá, ${name}! Use este link para ${state.firstAccess ? "criar" : "trocar"} sua senha do netzsales:`} />
      )}
    </div>
  );
}

/** Anotações internas da equipe sobre a empresa. */
export function NotesForm({ organizationId, notes, contact }: { organizationId: string; notes: string; contact: string | null }) {
  const [state, action] = useActionState(organizationNotesAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="Contato principal" name="contact" state={state} hint="Ex.: Anne · (11) 99999-9999">
        <input id="contact" name="contact" maxLength={200} defaultValue={contact ?? ""} />
      </Field>
      <Field label="Anotações" name="notes" state={state} hint="Combinados, pendências, como a empresa usa o sistema. Só a equipe netzsales vê.">
        <textarea id="notes" name="notes" rows={6} maxLength={5000} defaultValue={notes} />
      </Field>
      <div className="actions"><SubmitButton>Salvar anotações</SubmitButton></div>
    </form>
  );
}

/** Sair de uma empresa em que entrou para dar suporte. */
export function LeaveSupport({ organizationId, name }: { organizationId: string; name: string }) {
  const [state, action] = useActionState(leaveSupportAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Sair de ${name}? Você deixa de aparecer como usuário da empresa.`)) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <SubmitButton className="secondary" pendingText="Saindo...">Encerrar suporte e sair da empresa</SubmitButton>
    </form>
  );
}

/** Mensalidade que a empresa paga (anotada pela equipe). */
export function BillingForm({ organizationId, planName, monthlyPrice, status, notes }: { organizationId: string; planName: string | null; monthlyPrice: string; status: string; notes: string }) {
  const [state, action] = useActionState(billingAction, null);
  const price = Number(monthlyPrice);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid-2">
        <Field label="Situação" name="status" state={state}>
          <select id="status" name="status" defaultValue={status}>
            <option value="trial">Em teste</option>
            <option value="paying">Pagando</option>
            <option value="overdue">Em atraso</option>
            <option value="free">Cortesia</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </Field>
        <Field label="Mensalidade (R$)" name="monthlyPrice" state={state}>
          <input id="monthlyPrice" name="monthlyPrice" inputMode="decimal" defaultValue={price ? price.toFixed(2).replace(".", ",") : ""} placeholder="0,00" />
        </Field>
        <Field label="Plano" name="planName" state={state} hint="Ex.: Básico, Completo">
          <input id="planName" name="planName" maxLength={80} defaultValue={planName ?? ""} />
        </Field>
        <Field label="Observação" name="notes" state={state}>
          <input id="notes" name="notes" maxLength={2000} defaultValue={notes} placeholder="Ex.: paga todo dia 10 por Pix" />
        </Field>
      </div>
      <div className="actions"><SubmitButton>Salvar mensalidade</SubmitButton></div>
    </form>
  );
}

/** Cliente ou interna da equipe. */
export function OrganizationKind({ organizationId, kind }: { organizationId: string; kind: "customer" | "internal" }) {
  const [state, action] = useActionState(organizationKindAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="kind" value={kind === "customer" ? "internal" : "customer"} />
      <SubmitButton className="secondary" pendingText="Salvando...">{kind === "customer" ? "Marcar como interna da equipe" : "Marcar como cliente"}</SubmitButton>
    </form>
  );
}

/** Exclui a empresa de vez: pede o nome digitado. */
export function DeleteOrganization({ organizationId, name }: { organizationId: string; name: string }) {
  const [state, action] = useActionState(deleteOrganizationAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Excluir ${name} de vez? Todas as vendas, produtos, clientes e pessoas dela serão apagados. Não dá para desfazer.`)) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <Field label={`Para confirmar, digite: ${name}`} name="confirmName" state={state}>
        <input id="confirmName" name="confirmName" autoComplete="off" required />
      </Field>
      <SubmitButton className="danger" pendingText="Excluindo...">Excluir empresa de vez</SubmitButton>
    </form>
  );
}
