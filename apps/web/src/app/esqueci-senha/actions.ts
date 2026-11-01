"use server";

import { requestPasswordReset } from "@erp/core";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { enabled } = await requestPasswordReset(db(), str(form, "email"));
    if (!enabled) {
      return { ok: false, message: "O envio do link ainda não está ativo. Peça ao administrador da sua empresa um link de senha." };
    }
  } catch (err) {
    return toFormState(err);
  }
  return { ok: true, message: "Se este e-mail tiver conta, enviamos o link para criar a senha nova pelo e-mail e pelo Telegram ligado à conta. Confira também o spam." };
}
