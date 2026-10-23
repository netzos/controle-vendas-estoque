"use server";

import { requestAnotherOrganization } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, str, toFormState, type FormState } from "@/lib/actions";

export async function anotherOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const r = await requestAnotherOrganization(db(), await currentActor(), {
      organizationName: str(form, "organizationName"),
      business: optional(form, "business"),
    });
    return { ok: true, message: `Pedido nº ${r.number} enviado. Assim que for aprovado, a empresa aparece no seletor do alto da tela e no Telegram (/empresa).` };
  } catch (err) {
    return toFormState(err);
  }
}
