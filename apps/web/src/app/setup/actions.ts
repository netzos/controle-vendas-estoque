"use server";

import { redirect } from "next/navigation";
import { login, setupFirstAdmin } from "@erp/core";
import { db } from "@/lib/db";
import { clientIp, setSessionCookie } from "@/lib/auth";
import { optional, str, toFormState, type FormState } from "@/lib/actions";

export async function setupAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    if (str(form, "password") !== str(form, "passwordConfirm")) {
      return { ok: false, message: "As senhas não conferem.", fieldErrors: { passwordConfirm: "As senhas não conferem." } };
    }
    await setupFirstAdmin(db(), {
      name: str(form, "name"),
      email: str(form, "email"),
      password: str(form, "password"),
      organization: {
        name: str(form, "organizationName"),
        legalName: optional(form, "legalName"),
        document: optional(form, "document"),
        timezone: str(form, "timezone") || "America/Sao_Paulo",
      },
    });
    const { token } = await login(db(), { email: str(form, "email"), password: str(form, "password"), ip: await clientIp() });
    await setSessionCookie(token);
  } catch (err) {
    const state = toFormState(err);
    // Nomes de campo do formulário diferem do schema aninhado.
    if (state?.fieldErrors?.["organization.name"]) state.fieldErrors.organizationName = state.fieldErrors["organization.name"];
    return state;
  }
  redirect("/");
}
