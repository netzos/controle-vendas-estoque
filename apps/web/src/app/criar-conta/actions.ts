"use server";

import { requestSignup } from "@erp/core";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth";
import { optional, str, toFormState, type FormState } from "@/lib/actions";

export type SignupState = (FormState & { telegramUrl?: string | null }) | null;

export async function signupAction(_: SignupState, form: FormData): Promise<SignupState> {
  // Campo invisível: só robô preenche.
  if (str(form, "website")) return { ok: true, message: "done" };
  if (str(form, "password") !== str(form, "passwordConfirm")) {
    return { ok: false, message: "As senhas não conferem.", fieldErrors: { passwordConfirm: "As senhas não conferem." } };
  }
  try {
    const r = await requestSignup(
      db(),
      {
        name: str(form, "name"),
        email: str(form, "email"),
        whatsapp: optional(form, "whatsapp"),
        organizationName: str(form, "organizationName"),
        business: optional(form, "business"),
        password: str(form, "password"),
      },
      await clientIp(),
    );
    return { ok: true, message: "done", telegramUrl: r.telegramUrl };
  } catch (err) {
    return toFormState(err);
  }
}
