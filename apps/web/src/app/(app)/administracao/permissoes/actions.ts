"use server";

import { createRole, deleteRole, updateRole } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

const permissions = (form: FormData) => form.getAll("permissions").filter((v): v is string => typeof v === "string");

export async function createRoleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    createRole,
    { name: str(form, "name"), description: optional(form, "description"), permissions: permissions(form) },
    { successMessage: "Perfil criado.", revalidate: "/administracao/permissoes" },
  );
}

export async function updateRoleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateRole,
    { id: str(form, "id"), name: str(form, "name"), description: optional(form, "description"), permissions: permissions(form) },
    { successMessage: "Perfil salvo.", revalidate: "/administracao/permissoes" },
  );
}

export async function deleteRoleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(deleteRole, { id: str(form, "id") }, { successMessage: "Perfil excluído.", revalidate: "/administracao/permissoes" });
}
