"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@erp/core";
import { db } from "@/lib/db";
import { clearSessionCookie, clientIp, sessionToken, setSessionCookie } from "@/lib/auth";
import { str, toFormState, type FormState } from "@/lib/actions";
import { headers } from "next/headers";

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  let mustChange = false;
  try {
    const result = await login(db(), {
      email: str(form, "email"),
      password: str(form, "password"),
      ip: await clientIp(),
      userAgent: (await headers()).get("user-agent")?.slice(0, 300) ?? null,
    });
    await setSessionCookie(result.token);
    mustChange = result.session.mustChangePassword;
  } catch (err) {
    return toFormState(err);
  }
  redirect(mustChange ? "/conta/senha?primeiro=1" : "/");
}

export async function logoutAction(): Promise<void> {
  const token = await sessionToken();
  if (token) await logout(db(), token);
  await clearSessionCookie();
  redirect("/login");
}
