import { randomBytes } from "node:crypto";
import type { Db, Tx } from "@erp/db";
import { withTransaction } from "@erp/db";
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import { appUrl, mailConfigured, sendMail } from "../mail.ts";
import { telegramApi, telegramConfigured, type TelegramApi } from "../modules/telegram/api.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password.ts";
import { hashToken, normalizeEmail } from "./session.ts";

// Recuperação de senha e convite por e-mail. O link carrega um token de uso
// único; no banco fica só o hash.

const RESET_TTL_MINUTES = 60;
export const INVITE_TTL_DAYS = 7;
const MAX_RESETS_PER_HOUR = 3;

export type TokenPurpose = "reset" | "invite";

async function issueToken(tx: Tx | Db, userId: string, purpose: TokenPurpose, minutes: number, organizationId?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Um link novo invalida os anteriores do mesmo tipo.
  await tx.query(
    "UPDATE controle_vendas_estoque.password_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL",
    [userId, purpose],
  );
  await tx.query(
    `INSERT INTO controle_vendas_estoque.password_tokens (user_id, purpose, token_hash, organization_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [userId, purpose, hashToken(token), organizationId ?? null, minutes],
  );
  return token;
}

/**
 * Pede um link de nova senha. O link vai por e-mail (quando o envio está
 * configurado) e também pelo Telegram, para quem ligou a conta ao bot; assim a
 * recuperação funciona mesmo sem e-mail. A resposta é sempre a mesma, exista o
 * e-mail ou não, para não revelar quem tem conta. enabled avisa a tela quando
 * nenhum dos dois caminhos está ativo.
 */
export async function requestPasswordReset(
  db: Db,
  rawEmail: string,
  deps: { telegram?: TelegramApi | null } = {},
): Promise<{ enabled: boolean }> {
  const mailOn = mailConfigured();
  const telegram = deps.telegram !== undefined ? deps.telegram : telegramConfigured() ? telegramApi : null;
  if (!mailOn && !telegram) return { enabled: false };
  const email = normalizeEmail(rawEmail);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new AppError("invalid_input", "E-mail inválido.");
  const { rows } = await db.query<{ id: string; name: string; recent: number; chats: string[] }>(
    `SELECT u.id, u.name,
            (SELECT count(*)::int FROM controle_vendas_estoque.password_tokens t
              WHERE t.user_id = u.id AND t.purpose = 'reset' AND t.created_at > now() - interval '1 hour') AS recent,
            ARRAY(SELECT DISTINCT l.chat_id::text FROM controle_vendas_estoque.telegram_links l
                   WHERE l.user_id = u.id AND l.status = 'active') AS chats
       FROM controle_vendas_estoque.users u WHERE u.email = $1 AND u.status = 'active'`,
    [email],
  );
  const user = rows[0];
  if (!user || user.recent >= MAX_RESETS_PER_HOUR) return { enabled: true };
  const chats = telegram ? user.chats : [];
  if (!mailOn && chats.length === 0) return { enabled: true };
  const token = await issueToken(db, user.id, "reset", RESET_TTL_MINUTES);
  const link = `${appUrl()}/redefinir-senha?token=${token}`;
  const text =
    `Olá, ${user.name}.\n\nPara criar uma nova senha, abra o link abaixo. Ele vale por ${RESET_TTL_MINUTES} minutos e só pode ser usado uma vez.\n\n${link}\n\n` +
    "Se você não pediu, pode ignorar esta mensagem: sua senha continua a mesma.";
  // Um caminho que falha não impede o outro; a falha fica só no log.
  const sends: Promise<unknown>[] = [];
  if (mailOn) sends.push(sendMail({ to: email, subject: "Redefinir sua senha do netzsales", text }));
  for (const chatId of chats) sends.push(telegram!.call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } }));
  const results = await Promise.allSettled(sends);
  for (const r of results) if (r.status === "rejected") console.error("password reset send failed", r.reason instanceof Error ? r.reason.message : r.reason);
  return { enabled: true };
}

export async function sendInvite(tx: Tx, params: { userId: string; email: string; name: string; organizationId: string; organizationName: string }) {
  const token = await issueToken(tx, params.userId, "invite", INVITE_TTL_DAYS * 24 * 60, params.organizationId);
  const link = `${appUrl()}/redefinir-senha?token=${token}`;
  await sendMail({
    to: params.email,
    subject: `Convite para ${params.organizationName} no netzsales`,
    text:
      `Olá, ${params.name}.\n\nVocê foi convidado(a) para usar o netzsales na empresa ${params.organizationName}. ` +
      `Abra o link abaixo para criar sua senha. Ele vale por ${INVITE_TTL_DAYS} dias.\n\n${link}`,
  });
}

/** Link de senha para o administrador mandar à pessoa (WhatsApp, por exemplo), sem depender de e-mail. */
export async function issuePasswordLink(tx: Tx, userId: string, organizationId: string, firstAccess: boolean): Promise<{ url: string; validFor: string }> {
  const minutes = firstAccess ? INVITE_TTL_DAYS * 24 * 60 : 24 * 60;
  const token = await issueToken(tx, userId, firstAccess ? "invite" : "reset", minutes, organizationId);
  return { url: `${appUrl()}/redefinir-senha?token=${token}`, validFor: firstAccess ? `${INVITE_TTL_DAYS} dias` : "24 horas" };
}

// Confere o link sem consumir, para a tela mostrar o nome e o tipo.
export async function inspectPasswordToken(db: Db, token: string): Promise<{ purpose: TokenPurpose; name: string; email: string } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await db.query<{ purpose: TokenPurpose; name: string; email: string }>(
    `SELECT t.purpose, u.name, u.email FROM controle_vendas_estoque.password_tokens t
       JOIN controle_vendas_estoque.users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

const resetInput = z.object({
  token: z.string().min(20).max(100),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200),
});

// Grava a nova senha, consome o link e encerra todas as sessões abertas.
export async function resetPassword(db: Db, raw: z.input<typeof resetInput>): Promise<{ email: string }> {
  const input = parseInput(resetInput, raw);
  const hash = await hashPassword(input.newPassword);
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; userId: string; email: string }>(
      `SELECT t.id, t.user_id AS "userId", u.email FROM controle_vendas_estoque.password_tokens t
         JOIN controle_vendas_estoque.users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'active'
        FOR UPDATE OF t`,
      [hashToken(input.token)],
    );
    const t = rows[0];
    if (!t) throw new AppError("invalid_input", "Este link expirou ou já foi usado. Peça um novo.");
    await tx.query("UPDATE controle_vendas_estoque.password_tokens SET used_at = now() WHERE id = $1", [t.id]);
    await tx.query("UPDATE controle_vendas_estoque.users SET password_hash = $2, must_change_password = false WHERE id = $1", [t.userId, hash]);
    await tx.query("UPDATE controle_vendas_estoque.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [t.userId]);
    return { email: t.email };
  });
}
