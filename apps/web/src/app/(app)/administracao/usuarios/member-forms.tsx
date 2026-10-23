"use client";

import { useActionState, useState } from "react";
import type { Branch, Member, Role } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { addMemberAction, passwordLinkAction, telegramLinkAction, updateMemberAction } from "./actions";

function BranchPicker({ branches, selected, prefix }: { branches: Branch[]; selected: string[] | null; prefix: string }) {
  const [all, setAll] = useState(selected === null);
  return (
    <div className="field">
      <label>Filiais</label>
      <label style={{ fontWeight: 400, display: "flex", gap: 8 }}>
        <input type="checkbox" name="allBranches" value="1" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Todas as filiais
      </label>
      {!all && (
        <div className="perm-grid">
          {branches.map((b) => (
            <label key={b.id} htmlFor={`${prefix}-${b.id}`}>
              <input id={`${prefix}-${b.id}`} type="checkbox" name="branchIds" value={b.id} defaultChecked={selected?.includes(b.id)} />
              {b.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleSelect({ roles, defaultValue, id }: { roles: Role[]; defaultValue?: string; id: string }) {
  return (
    <select id={id} name="roleId" defaultValue={defaultValue ?? ""} required>
      <option value="" disabled>Selecione</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}

export function AddMemberForm({ roles, branches, mailEnabled }: { roles: Role[]; branches: Branch[]; mailEnabled: boolean }) {
  const [state, action] = useActionState(addMemberAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <div className="grid-2">
        <Field label="Nome" name="name" state={state}>
          <input id="new-name" name="name" required maxLength={120} />
        </Field>
        <Field label="E-mail" name="email" state={state}>
          <input id="new-email" name="email" type="email" required />
        </Field>
        <Field label="Perfil de acesso" name="roleId" state={state}>
          <RoleSelect roles={roles} id="new-role" />
        </Field>
        <Field
          label={mailEnabled ? "Senha provisória (opcional)" : "Senha provisória"}
          name="temporaryPassword"
          state={state}
          hint={mailEnabled ? "Deixe vazio para enviar um convite por e-mail." : "Obrigatória para quem ainda não tem conta. Mínimo de 10 caracteres."}
        >
          <input id="new-password" name="temporaryPassword" type="text" autoComplete="off" minLength={10} />
        </Field>
      </div>
      <BranchPicker branches={branches} selected={null} prefix="new" />
      <div className="actions"><SubmitButton>Adicionar usuário</SubmitButton></div>
    </form>
  );
}

export function EditMemberForm({ member, roles, branches }: { member: Member; roles: Role[]; branches: Branch[] }) {
  const [state, action] = useActionState(updateMemberAction, null);
  const p = `m-${member.membershipId}`;
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="membershipId" value={member.membershipId} />
      <div className="grid-2">
        <Field label="Nome" name="name" state={state} hint={member.lastLoginAt ? "Depois do primeiro acesso, só a própria pessoa muda." : undefined}>
          <input id={`${p}-name`} name="name" defaultValue={member.name} required maxLength={120} disabled={!!member.lastLoginAt} />
        </Field>
        <Field label="E-mail" name="email" state={state}>
          <input id={`${p}-email`} name="email" type="email" defaultValue={member.email} required disabled={!!member.lastLoginAt} />
        </Field>
        <Field label="Perfil de acesso" name="roleId" state={state}>
          <RoleSelect roles={roles} defaultValue={member.roleId} id={`${p}-role`} />
        </Field>
        <Field label="Situação" name="status" state={state}>
          <select id={`${p}-status`} name="status" defaultValue={member.status}>
            <option value="active">Ativo</option>
            <option value="disabled">Desativado</option>
          </select>
        </Field>
      </div>
      <BranchPicker branches={branches} selected={member.branchIds} prefix={p} />
      <div className="actions"><SubmitButton>Salvar</SubmitButton></div>
    </form>
  );
}

/** Gera o link de senha para mandar à pessoa pelo WhatsApp (sem depender de e-mail). */
export function PasswordLink({ member }: { member: Member }) {
  const [state, action] = useActionState(passwordLinkAction, null);
  const [copied, setCopied] = useState(false);
  const whatsapp = state?.url
    ? `https://wa.me/?text=${encodeURIComponent(`Olá, ${member.name}! Use este link para ${member.lastLoginAt ? "trocar" : "criar"} sua senha do netzsales: ${state.url}`)}`
    : null;
  return (
    <div className="remove-record">
      <h3>Senha</h3>
      <p className="muted">
        {member.lastLoginAt ? "Gere um link para a pessoa trocar a senha." : "A pessoa ainda não entrou. Gere um link para ela criar a senha."} Mande pelo WhatsApp.
      </p>
      {state?.message && <div className={`alert ${state.ok ? "success" : "error"}`}>{state.message}</div>}
      {state?.url && (
        <div className="link-box">
          <input readOnly value={state.url} aria-label="Link de senha" onFocus={(e) => e.currentTarget.select()} />
          <div className="actions">
            <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(state.url!).then(() => setCopied(true))}>
              {copied ? "Copiado" : "Copiar link"}
            </button>
            {whatsapp && <a className="button" href={whatsapp} target="_blank" rel="noreferrer">Mandar no WhatsApp</a>}
          </div>
        </div>
      )}
      <form action={action}>
        <input type="hidden" name="membershipId" value={member.membershipId} />
        <SubmitButton className="secondary" pendingText="Gerando...">{state?.url ? "Gerar outro link" : "Gerar link de senha"}</SubmitButton>
      </form>
    </div>
  );
}

/** Link do Telegram da pessoa: ela toca no WhatsApp e já cai na conversa com a Netz, com a conta ligada. */
export function TelegramLink({ member, linked }: { member: Member; linked: boolean }) {
  const [state, action] = useActionState(telegramLinkAction, null);
  const [copied, setCopied] = useState(false);
  const whatsapp = state?.url
    ? `https://wa.me/?text=${encodeURIComponent(`Olá, ${member.name}! Toque neste link para falar com a Netz, a assistente do netzsales, no Telegram. Depois é só tocar em Iniciar: ${state.url}`)}`
    : null;
  return (
    <div className="remove-record">
      <h3>Telegram</h3>
      <p className="muted">
        {linked ? "Já está ligado ao Telegram. Gere um link novo só se a pessoa trocou de celular ou de conta." : "Ainda não está ligado. Gere o link e mande pelo WhatsApp: a pessoa toca e já conversa com a Netz."}
      </p>
      {state?.message && <div className={`alert ${state.ok ? "success" : "error"}`}>{state.message}</div>}
      {state?.url && (
        <div className="link-box">
          <input readOnly value={state.url} aria-label="Link do Telegram" onFocus={(e) => e.currentTarget.select()} />
          <div className="actions">
            <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(state.url!).then(() => setCopied(true))}>
              {copied ? "Copiado" : "Copiar link"}
            </button>
            {whatsapp && <a className="button" href={whatsapp} target="_blank" rel="noreferrer">Mandar no WhatsApp</a>}
          </div>
        </div>
      )}
      <form action={action}>
        <input type="hidden" name="membershipId" value={member.membershipId} />
        <SubmitButton className="secondary" pendingText="Gerando...">{state?.url ? "Gerar outro link" : "Gerar link do Telegram"}</SubmitButton>
      </form>
    </div>
  );
}
