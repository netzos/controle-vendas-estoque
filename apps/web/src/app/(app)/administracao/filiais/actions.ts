"use server";

import { createBranch, updateBranch } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

export async function createBranchAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    createBranch,
    { name: str(form, "name"), code: str(form, "code"), document: optional(form, "document") },
    { successMessage: "Filial cadastrada.", revalidate: "/administracao/filiais" },
  );
}

export async function updateBranchAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateBranch,
    {
      id: str(form, "id"),
      name: str(form, "name"),
      code: str(form, "code"),
      document: optional(form, "document"),
      status: str(form, "status") === "inactive" ? "inactive" : "active",
    },
    { successMessage: "Filial salva.", revalidate: "/administracao/filiais" },
  );
}
