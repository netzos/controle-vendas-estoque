import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, getSession, isPlatformDeveloper, resolveActor, SESSION_TTL_HOURS, type Actor, type Permission, type SessionInfo } from "@erp/core";
import { db } from "./db";

export const SESSION_COOKIE = "erp_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

// Uma consulta de sessão por requisição.
export const currentSession = cache(async (): Promise<SessionInfo | null> => {
  return getSession(db(), await sessionToken());
});

export async function requireSession(): Promise<SessionInfo> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

// Ator da requisição: usuário autenticado + empresa ativa da sessão.
// Permissões vêm do banco a cada requisição; nada vem do formulário.
export const currentActor = cache(async (): Promise<Actor> => {
  const session = await requireSession();
  if (session.mustChangePassword) redirect("/conta/senha?primeiro=1");
  if (!session.activeOrganizationId) redirect("/sem-empresa");
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  try {
    return await resolveActor(db(), {
      userId: session.userId,
      organizationId: session.activeOrganizationId,
      channel: "web",
      requestId,
    });
  } catch {
    redirect("/sem-empresa");
  }
});

export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await currentActor();
  if (!can(actor, permission)) redirect("/sem-permissao");
  return actor;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/** Telas da plataforma: só quem está em platform_developers. */
export async function requireDeveloper(): Promise<Actor> {
  const actor = await currentActor();
  if (!(await isPlatformDeveloper(db(), actor.userId))) redirect("/sem-permissao");
  return actor;
}
