"use server";

import { addMember, updateMember } from "@erp/core";
import { perform, str, type FormState } from "@/lib/actions";

function branchIds(form: FormData): string[] | null {
  if (str(form, "allBranches") === "1") return null;
  return form.getAll("branchIds").filter((v): v is string => typeof v === "string");
}

export async function addMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const password = str(form, "temporaryPassword");
  return perform(
    addMember,
    {
      email: str(form, "email"),
      name: str(form, "name"),
      roleId: str(form, "roleId"),
      branchIds: branchIds(form),
      temporaryPassword: password || undefined,
    },
    { successMessage: "Usuário adicionado. No primeiro acesso ele precisará trocar a senha provisória.", revalidate: "/administracao/usuarios" },
  );
}

export async function updateMemberAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateMember,
    {
      membershipId: str(form, "membershipId"),
      roleId: str(form, "roleId"),
      branchIds: branchIds(form),
      status: str(form, "status") === "disabled" ? "disabled" : "active",
    },
    { successMessage: "Acesso atualizado.", revalidate: "/administracao/usuarios" },
  );
}
