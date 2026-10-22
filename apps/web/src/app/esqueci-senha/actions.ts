"use server";

import { requestPasswordReset } from "@erp/core";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { mailEnabled } = await requestPasswordReset(db(), str(form, "email"));
    if (!mailEnabled) {
      return { ok: false, message: "O envio de e-mail ainda não está ativo. Peça ao administrador da sua empresa uma senha provisória." };
    }
  } catch (err) {
    return toFormState(err);
  }
  return { ok: true, message: "Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também o spam." };
}
