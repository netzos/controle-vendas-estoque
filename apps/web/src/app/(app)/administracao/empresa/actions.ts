"use server";

import { updateOrganization } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

export async function updateOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateOrganization,
    { name: str(form, "name"), legalName: optional(form, "legalName"), document: optional(form, "document"), timezone: str(form, "timezone") },
    { successMessage: "Dados da empresa salvos.", revalidate: "/administracao/empresa" },
  );
}
