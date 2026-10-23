import type { Db } from "@erp/db";
import { setTenant, withTransaction } from "@erp/db";
import { z } from "zod";
import { recordAudit } from "../../audit.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../auth/password.ts";
import { normalizeEmail } from "../../auth/session.ts";
import { AppError, conflict, forbidden, notFound, parseInput } from "../../errors.ts";
import { appUrl, mailConfigured, sendMail } from "../../mail.ts";
import { telegramConfigured } from "../telegram/api.ts";
import { createSignupTelegramLink, createTelegramInvite, linkSignupTelegramTx, notifyTelegram, signupTelegramChat, type TelegramDeps } from "../telegram/service.ts";
import { createOrganizationTx } from "./bootstrap.ts";
import { isPlatformDeveloper, listPlatformOrganizations } from "./platform.ts";

// Cadastro aberto com aprovação: a pessoa pede a conta pelo site e só entra
// depois que o administrador da plataforma aprova.

const MAX_REQUESTS_PER_IP_HOUR = 5;

export const signupInput = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("E-mail inválido."),
  whatsapp: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || v.replace(/\D/g, "").length >= 10, "Informe o WhatsApp com DDD.")
    .optional()
    .nullable(),
  organizationName: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  business: z.string().trim().max(500, "Use até 500 caracteres.").optional().nullable(),
  password: z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200),
});

export type SignupStatus = "pending" | "approved" | "rejected";

export interface SignupRequest {
  id: string;
  number: number;
  name: string;
  email: string;
  whatsapp: string | null;
  organizationName: string;
  business: string | null;
  status: SignupStatus;
  decidedByName: string | null;
  decidedAt: Date | null;
  rejectReason: string | null;
  organizationId: string | null;
  /** A pessoa já abriu o robô pelo link da tela "pedido recebido". */
  telegramLinked: boolean;
  createdAt: Date;
}

const SELECT = `
  SELECT r.id, r.number::int AS number, r.name, r.email, r.whatsapp, r.organization_name AS "organizationName", r.business, r.status,
         u.name AS "decidedByName", r.decided_at AS "decidedAt", r.reject_reason AS "rejectReason",
         r.organization_id AS "organizationId", r.telegram_user_id IS NOT NULL AS "telegramLinked", r.created_at AS "createdAt"
    FROM controle_vendas_estoque.signup_requests r
    LEFT JOIN controle_vendas_estoque.users u ON u.id = r.decided_by`;

/** Pedido de conta feito pelo site. Não dá acesso a nada até ser aprovado. */
export async function requestSignup(
  db: Db,
  raw: z.input<typeof signupInput>,
  ip?: string | null,
  deps: TelegramDeps = {},
): Promise<{ number: number; telegramUrl: string | null }> {
  const input = parseInput(signupInput, raw);
  const email = normalizeEmail(input.email);
  // WhatsApp guardado só com dígitos e DDI: "(91) 98888-7777" → "5591988887777".
  const digits = input.whatsapp?.replace(/\D/g, "") ?? "";
  const whatsapp = digits ? (digits.length <= 11 ? `55${digits}` : digits) : null;
  if (ip) {
    const recent = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM controle_vendas_estoque.signup_requests WHERE ip = $1 AND created_at > now() - interval '1 hour'",
      [ip],
    );
    if (recent.rows[0]!.n >= MAX_REQUESTS_PER_IP_HOUR) throw new AppError("rate_limited", "Muitos pedidos seguidos. Tente de novo mais tarde.");
  }
  const user = await db.query("SELECT 1 FROM controle_vendas_estoque.users WHERE email = $1", [email]);
  if (user.rowCount) {
    throw new AppError("conflict", "Este e-mail já tem conta. Entre pela tela de login ou use \"Esqueci minha senha\".", {
      details: { issues: [{ path: "email", message: "Este e-mail já tem conta." }] },
    });
  }
  const pending = await db.query("SELECT 1 FROM controle_vendas_estoque.signup_requests WHERE email = $1 AND status = 'pending'", [email]);
  if (pending.rowCount) throw conflict("Já recebemos um pedido com este e-mail. Ele está em análise; avisaremos quando for aprovado.");
  const { rows } = await db.query<{ id: string; number: number }>(
    `INSERT INTO controle_vendas_estoque.signup_requests (name, email, whatsapp, organization_name, business, password_hash, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number::int AS number`,
    [input.name, email, whatsapp, input.organizationName, input.business || null, await hashPassword(input.password), ip ?? null],
  );
  const { id, number } = rows[0]!;
  // A pessoa já fala com a Netz no Telegram enquanto espera a aprovação.
  return { number, telegramUrl: await createSignupTelegramLink(db, id, deps) };
}

async function assertDeveloper(db: Db, userId: string) {
  if (!(await isPlatformDeveloper(db, userId))) throw forbidden("Só o administrador da plataforma pode fazer isso.");
}

export async function listSignupRequests(db: Db, developerUserId: string, status: SignupStatus | "all" = "all"): Promise<SignupRequest[]> {
  await assertDeveloper(db, developerUserId);
  const { rows } = await db.query<SignupRequest>(
    `${SELECT} WHERE ($1 = 'all' OR r.status = $1) ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 200`,
    [status],
  );
  return rows;
}

/**
 * Aprova o pedido: cria a conta com a senha que a pessoa escolheu e a empresa
 * pronta (matriz, perfis, unidades, etapas), com ela como proprietária.
 */
export async function approveSignup(
  db: Db,
  developer: { userId: string; userName: string },
  requestId: string,
  deps: TelegramDeps = {},
): Promise<{
  organizationId: string;
  name: string;
  email: string;
  whatsapp: string | null;
  organizationName: string;
  loginUrl: string;
  telegramUrl: string | null;
  telegramLinked: boolean;
}> {
  await assertDeveloper(db, developer.userId);
  if (!z.string().uuid().safeParse(requestId).success) throw notFound("Pedido");
  const orgNames = new Set((await listPlatformOrganizations(db, developer.userId)).map((o) => o.name.toLowerCase()));
  const result = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ name: string; email: string; whatsapp: string | null; organizationName: string; passwordHash: string; status: SignupStatus }>(
      `SELECT name, email, whatsapp, organization_name AS "organizationName", password_hash AS "passwordHash", status
         FROM controle_vendas_estoque.signup_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const r = rows[0];
    if (!r) throw notFound("Pedido");
    if (r.status !== "pending") throw conflict("Este pedido já foi decidido.");
    const taken = await tx.query("SELECT 1 FROM controle_vendas_estoque.users WHERE email = $1", [r.email]);
    if (taken.rowCount) throw conflict("Este e-mail ganhou uma conta depois do pedido. Recuse o pedido e crie a empresa pela aba Empresas.");
    // Nome repetido ganha um complemento para não confundir na lista.
    let orgName = r.organizationName;
    for (let i = 2; orgNames.has(orgName.toLowerCase()); i++) orgName = `${r.organizationName} (${i})`;

    const u = await tx.query<{ id: string }>(
      "INSERT INTO controle_vendas_estoque.users (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, false) RETURNING id",
      [r.email, r.name, r.passwordHash],
    );
    const userId = u.rows[0]!.id;
    const { organizationId } = await createOrganizationTx(tx, userId, { name: orgName });
    // Quem abriu o robô pelo link do pedido já sai com o Telegram ligado.
    const telegramChat = await linkSignupTelegramTx(tx, requestId, userId, organizationId);
    await setTenant(tx, { organizationId, userId: developer.userId });
    await tx.query(
      `UPDATE controle_vendas_estoque.signup_requests
          SET status = 'approved', decided_by = $2, decided_at = now(), organization_id = $3, user_id = $4
        WHERE id = $1`,
      [requestId, developer.userId, organizationId, userId],
    );
    await recordAudit(tx, { organizationId, userId: developer.userId, channel: "web" }, {
      action: "signup.approve",
      entityType: "organization",
      entityId: organizationId,
      summary: `Cadastro de ${r.name} <${r.email}> aprovado por ${developer.userName}`,
    });
    return { organizationId, userId, telegramChat, name: r.name, email: r.email, whatsapp: r.whatsapp, organizationName: orgName, loginUrl: `${appUrl()}/login` };
  });
  if (result.telegramChat) {
    await notifyTelegram(
      result.telegramChat,
      `Boa notícia, ${result.name.split(" ")[0]}! Sua conta da ${result.organizationName} foi aprovada e já está ligada aqui.\n\n` +
        "Pode me pedir em texto ou por áudio o que precisar: registrar venda, cadastrar produto, ver estoque, lançar custo... " +
        `Antes de mudar qualquer coisa eu mostro o que vou fazer e você confirma.\n\nPelo navegador, o painel fica em ${result.loginUrl}`,
      deps,
    );
  }
  // A mensagem de aprovação já leva o robô: a pessoa toca e o Telegram abre com a conta ligada.
  const telegramUrl = telegramConfigured() && !result.telegramChat
    ? await createTelegramInvite(db, result.userId, result.organizationId, deps)
        .then((i) => i.url)
        .catch((err) => (console.error("[signup] link do Telegram não gerado", err), null))
    : null;
  if (mailConfigured()) {
    await sendMail({
      to: result.email,
      subject: `Sua conta no netzsales foi aprovada`,
      text:
        `Olá, ${result.name}.\n\nA ${result.organizationName} já está liberada no netzsales. Entre com seu e-mail e a senha que você criou:\n\n${result.loginUrl}` +
        (telegramUrl ? `\n\nPara falar com a Netz, sua assistente, no Telegram, toque aqui (vale 7 dias):\n\n${telegramUrl}` : ""),
    }).catch((err) => console.error("[signup] e-mail de aprovação não enviado", err));
  }
  const { organizationId, name, email, whatsapp, organizationName, loginUrl } = result;
  return { organizationId, name, email, whatsapp, organizationName, loginUrl, telegramUrl, telegramLinked: !!result.telegramChat };
}

export async function rejectSignup(
  db: Db,
  developer: { userId: string },
  requestId: string,
  reason?: string | null,
  deps: TelegramDeps = {},
): Promise<void> {
  await assertDeveloper(db, developer.userId);
  if (!z.string().uuid().safeParse(requestId).success) throw notFound("Pedido");
  const { rowCount } = await db.query(
    `UPDATE controle_vendas_estoque.signup_requests
        SET status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = $3
      WHERE id = $1 AND status = 'pending'`,
    [requestId, developer.userId, reason?.trim().slice(0, 500) || null],
  );
  if (!rowCount) throw conflict("Este pedido já foi decidido ou não existe.");
  const chat = await signupTelegramChat(db, requestId);
  if (chat) await notifyTelegram(chat, "Seu pedido de conta no netzsales não foi aprovado desta vez. Se achar que foi engano, fale com a equipe do netzsales.", deps);
}
