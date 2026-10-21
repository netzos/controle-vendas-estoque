"use client";

import { useActionState } from "react";
import type { PermissionDef, Role } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

const RISK = ["", "consulta", "simples", "comercial", "crítica"];

function PermissionChecks({ catalog, selected, prefix, disabled }: { catalog: PermissionDef[]; selected: string[]; prefix: string; disabled?: boolean }) {
  return (
    <div className="perm-grid">
      {catalog.map((p) => (
        <label key={p.key} htmlFor={`${prefix}-${p.key}`}>
          <input id={`${prefix}-${p.key}`} type="checkbox" name="permissions" value={p.key} defaultChecked={selected.includes(p.key)} disabled={disabled} />
          <span>
            {p.description} <span className="muted">({RISK[p.risk]})</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function RoleForm({ role, catalog, readOnly }: { role?: Role; catalog: PermissionDef[]; readOnly?: boolean }) {
  const [state, action] = useActionState(role ? updateRoleAction : createRoleAction, null);
  const p = role ? `r-${role.id}` : "new";
  const locked = readOnly || role?.key === "owner";
  return (
    <form action={action}>
      <FormMessage state={state} />
      {role && <input type="hidden" name="id" value={role.id} />}
      <div className="grid-2">
        <Field label="Nome" name="name" state={state}>
          <input id={`${p}-name`} name="name" defaultValue={role?.name} required maxLength={60} readOnly={role?.isSystem || locked} />
        </Field>
        <Field label="Descrição" name="description" state={state}>
          <input id={`${p}-description`} name="description" defaultValue={role?.description ?? ""} maxLength={200} readOnly={locked} />
        </Field>
      </div>
      {role?.key === "owner" ? (
        <p className="muted">O proprietário sempre tem acesso total, inclusive às permissões de módulos futuros.</p>
      ) : (
        <PermissionChecks catalog={catalog} selected={role?.permissions ?? []} prefix={p} disabled={locked} />
      )}
      {!locked && <div className="actions"><SubmitButton>{role ? "Salvar perfil" : "Criar perfil"}</SubmitButton></div>}
    </form>
  );
}

export function DeleteRoleButton({ role }: { role: Role }) {
  const [state, action] = useActionState(deleteRoleAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={role.id} />
      <SubmitButton className="danger" pendingText="Excluindo...">Excluir perfil</SubmitButton>
    </form>
  );
}
