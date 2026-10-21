"use server";

import { updateSettings } from "@erp/core";
import { perform, str, type FormState } from "@/lib/actions";

export async function updateSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateSettings,
    {
      "general.trade_name_on_documents": str(form, "general.trade_name_on_documents"),
      "general.week_start": str(form, "general.week_start"),
      "general.quantity_decimals": Number(str(form, "general.quantity_decimals")),
    },
    { successMessage: "Configurações salvas.", revalidate: "/administracao/configuracoes" },
  );
}
