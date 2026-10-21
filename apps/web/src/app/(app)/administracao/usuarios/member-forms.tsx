"use client";

import { useActionState, useState } from "react";
import type { Branch, Member, Role } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { addMemberAction, updateMemberAction } from "./actions";

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

export function AddMemberForm({ roles, branches }: { roles: Role[]; branches: Branch[] }) {
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
        <Field label="Senha provisória" name="temporaryPassword" state={state} hint="Obrigatória para quem ainda não tem conta. Mínimo de 10 caracteres.">
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
      <div className="actions"><SubmitButton>Salvar acesso</SubmitButton></div>
    </form>
  );
}
