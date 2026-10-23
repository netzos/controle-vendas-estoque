import { createHash, randomBytes } from "node:crypto";
import type { Db, Tx } from "@erp/db";
import { withTenant, withTransaction } from "@erp/db";
import { can, resolveActor, type Actor } from "../../context.ts";
import { enabledFeatures } from "../../features.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { recordAudit } from "../../audit.ts";
import { listUserOrganizations } from "../../auth/session.ts";
import { appUrl } from "../../mail.ts";
import { transcribeAudioDetailed, transcriptionConfigured, type Transcriber } from "../../transcribe.ts";
import { recordTranscriptionUsage } from "../../usage.ts";
import { decideNetsAction, postNetsMessage, processNetsTurn, type NetsModel } from "../nets/service.ts";
import { telegramApi, telegramConfigured, telegramWebhookSecret, type TelegramApi } from "./api.ts";

// Netz no Telegram. Um robô da plataforma atende todo mundo; a pessoa liga a
// própria conta pelo painel (código de uso único no link t.me/robo?start=...)
// e a conversa é a mesma do balão do painel, com as mesmas permissões.

const CODE_TTL_MINUTES = 15;
// Link mandado por WhatsApp (aprovação do cadastro, Ajustes › Usuários): a pessoa pode demorar a abrir.
const INVITE_TTL_MINUTES = 7 * 24 * 60;
const TEXT_LIMIT = 4000;
// Limites do áudio: o getFile do Telegram só entrega até 20 MB.
const AUDIO_MAX_SECONDS = 10 * 60;
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;

export interface TelegramDeps {
  api?: TelegramApi;
  model?: NetsModel;
  transcribe?: Transcriber;
}

export interface TelegramStatus {
  configured: boolean;
  /** Conversa com o robô (sem código), para quem já está ligado. */
  botUrl: string | null;
  link: { username: string | null; firstName: string | null; organizationId: string; createdAt: Date } | null;
}

interface LinkRow {
  userId: string;
  organizationId: string;
  chatId: string;
  firstName: string | null;
}

const hash = (code: string) => createHash("sha256").update(code).digest();

/** uuid estável a partir de um texto (o update do Telegram vira o requestId da mensagem). */
function stableUuid(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

let botName: string | null = null;
async function botUsername(api: TelegramApi): Promise<string> {
  botName ??= (await api.call<{ username: string }>("getMe")).username;
  return botName;
}

/** Aponta o robô para este sistema (só muda se ainda não estiver apontado). */
async function ensureWebhook(api: TelegramApi) {
  const url = `${appUrl()}/api/telegram/webhook`;
  // Sempre regrava: se o token mudou, o segredo do webhook também muda.
  await api.call("setWebhook", { url, secret_token: telegramWebhookSecret(), allowed_updates: ["message", "callback_query"] });
}

export async function getTelegramStatus(db: Db, actor: Actor, deps: TelegramDeps = {}): Promise<TelegramStatus> {
  if (!can(actor, "nets.use")) throw forbidden();
  const configured = telegramConfigured();
  const bot = configured ? await botUsername(deps.api ?? telegramApi).catch(() => null) : null;
  const { rows } = await db.query<NonNullable<TelegramStatus["link"]>>(
    `SELECT username, first_name AS "firstName", organization_id AS "organizationId", created_at AS "createdAt"
       FROM controle_vendas_estoque.telegram_links WHERE user_id = $1 AND status = 'active'`,
    [actor.userId],
  );
  return { configured, botUrl: bot ? `https://t.me/${bot}` : null, link: rows[0] ?? null };
}

// Pedido de conta ---------------------------------------------------------------
// A tela "pedido recebido" traz o link do robô; o código começa com c_ para
// não se confundir com o código de ligação de quem já tem conta.
const SIGNUP_PREFIX = "c_";

/** Link do Telegram da tela "pedido recebido". Vale enquanto o pedido estiver em análise. */
export async function createSignupTelegramLink(db: Db, requestId: string, deps: TelegramDeps = {}): Promise<string | null> {
  if (!telegramConfigured()) return null;
  let bot: string;
  try {
    bot = await readyBot(deps.api ?? telegramApi);
  } catch {
    return null;
  }
  const code = randomBytes(18).toString("base64url");
  const { rowCount } = await db.query(
    "UPDATE controle_vendas_estoque.signup_requests SET telegram_code_hash = $2 WHERE id = $1 AND status = 'pending'",
    [requestId, hash(code)],
  );
  return rowCount ? `https://t.me/${bot}?start=${SIGNUP_PREFIX}${code}` : null;
}

/** Na aprovação (dentro da transação): liga a conta nova ao Telegram usado no pedido. Devolve o chat para avisar. */
export async function linkSignupTelegramTx(tx: Tx, requestId: string, userId: string, organizationId: string): Promise<string | null> {
  const { rows } = await tx.query<{ tgUser: string; chatId: string; username: string | null; firstName: string | null }>(
    `SELECT telegram_user_id AS "tgUser", telegram_chat_id AS "chatId", telegram_username AS username, telegram_first_name AS "firstName"
       FROM controle_vendas_estoque.signup_requests WHERE id = $1 AND telegram_user_id IS NOT NULL`,
    [requestId],
  );
  const r = rows[0];
  if (!r) return null;
  await tx.query(
    "UPDATE controle_vendas_estoque.telegram_links SET status = 'revoked' WHERE status = 'active' AND (user_id = $1 OR telegram_user_id = $2)",
    [userId, r.tgUser],
  );
  await tx.query(
    `INSERT INTO controle_vendas_estoque.telegram_links (user_id, organization_id, telegram_user_id, chat_id, username, first_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, organizationId, r.tgUser, r.chatId, r.username, r.firstName],
  );
  return r.chatId;
}

/** Chat do Telegram usado no pedido, para avisar da recusa. */
export async function signupTelegramChat(db: Db, requestId: string): Promise<string | null> {
  const { rows } = await db.query<{ chatId: string | null }>(
    `SELECT telegram_chat_id AS "chatId" FROM controle_vendas_estoque.signup_requests WHERE id = $1`,
    [requestId],
  );
  return rows[0]?.chatId ?? null;
}

/** Avisa no Telegram (aprovação e recusa do pedido). Falha só fica no log. */
export async function notifyTelegram(chatId: string, text: string, deps: TelegramDeps = {}): Promise<void> {
  await send(deps.api ?? telegramApi, chatId, text).catch((err) => console.error("telegram notify failed", err instanceof Error ? err.message : err));
}

async function connectSignup(db: Db, api: TelegramApi, msg: TgMessage, code: string) {
  const from = msg.from!;
  const { rows } = await db.query<{ id: string; name: string; organizationName: string; status: SignupStatusTg; tgUser: string | null }>(
    `SELECT id, name, organization_name AS "organizationName", status, telegram_user_id::text AS "tgUser"
       FROM controle_vendas_estoque.signup_requests WHERE telegram_code_hash = $1`,
    [hash(code)],
  );
  const r = rows[0];
  if (!r) {
    await send(api, msg.chat.id, "Não encontrei esse pedido de conta. Se você já tem conta, entre no netzsales e toque no botão Telegram, no alto da tela.");
    return;
  }
  if (r.tgUser && r.tgUser !== String(from.id)) {
    await send(api, msg.chat.id, "Esse link já foi usado por outra conta do Telegram.");
    return;
  }
  if (r.status === "rejected") {
    await send(api, msg.chat.id, "Esse pedido de conta não foi aprovado. Se achar que foi engano, fale com a equipe do netzsales.");
    return;
  }
  if (r.status === "approved") {
    await send(api, msg.chat.id, "Seu pedido já foi aprovado. Se eu ainda não te respondo por aqui, entre no netzsales e toque no botão Telegram, no alto da tela.");
    return;
  }
  await db.query(
    `UPDATE controle_vendas_estoque.signup_requests
        SET telegram_user_id = $2, telegram_chat_id = $3, telegram_username = $4, telegram_first_name = $5
      WHERE id = $1 AND status = 'pending'`,
    [r.id, from.id, msg.chat.id, from.username ?? null, from.first_name ?? null],
  );
  await send(
    api,
    msg.chat.id,
    `Olá, ${r.name.split(" ")[0]}! Eu sou a Netz, a assistente do netzsales.\n\n` +
      `Recebi seu pedido de conta para ${r.organizationName}. Ele está aguardando aprovação. ` +
      "Assim que for liberado, eu te aviso aqui mesmo e já podemos começar: você vai poder registrar vendas, ver o estoque e muito mais, por texto ou áudio.",
  );
}

/** Pedido novo: avisa o administrador da plataforma no Telegram, com os botões Aprovar e Recusar. */
export async function notifySignupRequest(
  db: Db,
  req: { id: string; number: number; name: string; email: string; whatsapp: string | null; organizationName: string; business: string | null },
  deps: TelegramDeps = {},
): Promise<void> {
  if (!telegramConfigured()) return;
  const { rows } = await db.query<{ chatId: string }>(
    `SELECT chat_id::text AS "chatId" FROM controle_vendas_estoque.telegram_links
      WHERE status = 'active' AND controle_vendas_estoque.is_platform_developer(user_id)`,
  );
  const text =
    `📝 Pedido de conta nº ${req.number}\n\n` +
    `Empresa: ${req.organizationName}\nNome: ${req.name}\nE-mail: ${req.email}` +
    (req.whatsapp ? `\nWhatsApp: +${req.whatsapp}` : "") +
    (req.business ? `\nO que vende: ${req.business}` : "") +
    "\n\nPosso liberar?";
  const markup = { inline_keyboard: [[{ text: "✅ Aprovar", callback_data: `signup:a:${req.id}` }, { text: "✖️ Recusar", callback_data: `signup:r:${req.id}` }]] };
  for (const r of rows) {
    await send(deps.api ?? telegramApi, r.chatId, text, markup).catch((err) => console.error("telegram signup notify failed", err instanceof Error ? err.message : err));
  }
}

/** Aprovar ou Recusar tocado na mensagem do pedido. Só o administrador da plataforma decide. */
async function onSignupDecision(db: Db, api: TelegramApi, cb: NonNullable<TelegramUpdate["callback_query"]>, approve: boolean, requestId: string, deps: TelegramDeps) {
  const answer = (text: string) => api.call("answerCallbackQuery", { callback_query_id: cb.id, text }).catch(() => {});
  const link = await findLink(db, cb.from.id);
  const { rows } = link
    ? await db.query<{ name: string; dev: boolean }>(
        "SELECT name, controle_vendas_estoque.is_platform_developer(id) AS dev FROM controle_vendas_estoque.users WHERE id = $1",
        [link.userId],
      )
    : { rows: [] };
  const dev = rows[0];
  if (!link || !dev?.dev) {
    await answer("Só o administrador da plataforma pode decidir.");
    return;
  }
  // Tira os botões para não decidir duas vezes.
  if (cb.message) {
    await api.call("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  // Import tardio: o cadastro também usa este módulo.
  const { approveSignup, rejectSignup } = await import("../organizations/signup.ts");
  const developer = { userId: link.userId, userName: dev.name };
  try {
    if (!approve) {
      await rejectSignup(db, developer, requestId, null, { ...deps, api });
      await answer("Recusado");
      await send(api, link.chatId, "Pedido recusado.");
      return;
    }
    const a = await approveSignup(db, developer, requestId, { ...deps, api });
    await answer("Aprovado");
    const notice =
      `Olá, ${a.name}! Sua conta no netzsales foi aprovada e a ${a.organizationName} já está liberada.\n\n` +
      (a.telegramUrl ? `Para falar com a Netz no Telegram, toque aqui e depois em Iniciar: ${a.telegramUrl}\n\n` : "") +
      `Para usar o painel no navegador, entre com seu e-mail e a senha que você criou: ${a.loginUrl}`;
    await send(
      api,
      link.chatId,
      `Aprovado. A ${a.organizationName} já está liberada.` +
        (a.telegramLinked ? ` Avisei ${a.name.split(" ")[0]} aqui no Telegram, e a conta já está ligada.` : ""),
      a.whatsapp && !a.telegramLinked
        ? { inline_keyboard: [[{ text: `Avisar ${a.name.split(" ")[0]} no WhatsApp`, url: `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(notice)}` }]] }
        : undefined,
    );
  } catch (err) {
    await answer("Não deu certo");
    await send(api, link.chatId, err instanceof AppError ? err.message : "Não consegui registrar a decisão. Tente pelo painel.");
  }
}

/** Quem ainda não tem conta ligada, mas tem pedido em análise feito por este Telegram. */
async function pendingSignup(db: Db, telegramUserId: number): Promise<{ name: string; organizationName: string } | null> {
  const { rows } = await db.query<{ name: string; organizationName: string }>(
    `SELECT name, organization_name AS "organizationName" FROM controle_vendas_estoque.signup_requests
      WHERE telegram_user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    [telegramUserId],
  );
  return rows[0] ?? null;
}

type SignupStatusTg = "pending" | "approved" | "rejected";

/** Em qual empresa o Telegram da pessoa está trabalhando (null = não ligado). */
export async function telegramOrganizationOf(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ organizationId: string }>(
    `SELECT organization_id AS "organizationId" FROM controle_vendas_estoque.telegram_links WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return rows[0]?.organizationId ?? null;
}

/** Painel: faz a Netz do Telegram trabalhar na empresa escolhida (mesmo efeito do /empresa). */
export async function setTelegramOrganization(db: Db, actor: Actor, organizationId: string, deps: TelegramDeps = {}): Promise<{ name: string }> {
  const { rows } = await db.query<LinkRow & { telegramUserId: string }>(
    `SELECT user_id AS "userId", organization_id AS "organizationId", chat_id::text AS "chatId", first_name AS "firstName", telegram_user_id::text AS "telegramUserId"
       FROM controle_vendas_estoque.telegram_links WHERE user_id = $1 AND status = 'active'`,
    [actor.userId],
  );
  const link = rows[0];
  if (!link) throw new AppError("conflict", "Seu Telegram ainda não está ligado. Toque em Conectar Telegram.");
  const org = (await listUserOrganizations(db, actor.userId)).find((o) => o.id === organizationId);
  if (!org) throw notFound("Empresa");
  if (link.organizationId === organizationId) return { name: org.name };
  if (!(await linkActor(db, { ...link, organizationId }))) throw forbidden(`Na empresa ${org.name} a Netz não está liberada para você.`);
  await db.query("UPDATE controle_vendas_estoque.telegram_links SET organization_id = $2 WHERE user_id = $1 AND status = 'active'", [actor.userId, organizationId]);
  await notifyTelegram(link.chatId, `Agora estou na empresa ${org.name} (trocada pelo painel). Para trocar de novo, envie /empresa.`, deps);
  return { name: org.name };
}

/** Pessoas desta empresa com o Telegram ligado (Ajustes › Usuários e botão do topo). */
export async function listTelegramLinkedUsers(db: Db, actor: Actor): Promise<Set<string>> {
  const { rows } = await db.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM controle_vendas_estoque.telegram_links WHERE organization_id = $1 AND status = 'active'`,
    [actor.organizationId],
  );
  return new Set(rows.map((r) => r.userId));
}

/** Prepara o robô e devolve o nome dele, com a mensagem certa quando o Telegram recusa o token. */
async function readyBot(api: TelegramApi): Promise<string> {
  if (!telegramConfigured()) throw new AppError("invalid_input", "O robô do Telegram ainda não foi ligado (falta TELEGRAM_BOT_TOKEN na Vercel).");
  try {
    await ensureWebhook(api);
    return await botUsername(api);
  } catch (err) {
    console.error("telegram connect", err);
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(
      "invalid_input",
      /unauthorized|not found/i.test(reason)
        ? "O Telegram não aceitou o token do robô. Copie o token atual no BotFather e troque o TELEGRAM_BOT_TOKEN na Vercel."
        : `O Telegram recusou a ligação (${reason}).`,
    );
  }
}

/** Código de uso único que liga a conta de quem tocar no link. Só o último código da pessoa vale. */
async function issueCode(db: Db, userId: string, organizationId: string, minutes: number): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await withTransaction(db, async (tx) => {
    await tx.query("UPDATE controle_vendas_estoque.telegram_link_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await tx.query(
      `INSERT INTO controle_vendas_estoque.telegram_link_codes (user_id, organization_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [userId, organizationId, hash(code), minutes],
    );
  });
  return code;
}

/** Link do botão "Telegram" do painel: abre o robô com um código que vale uma vez, por 15 minutos. */
export async function createTelegramLink(db: Db, actor: Actor, deps: TelegramDeps = {}): Promise<{ url: string }> {
  if (!can(actor, "nets.use")) throw forbidden("Você não tem permissão para conversar com a Netz.");
  const bot = await readyBot(deps.api ?? telegramApi);
  return { url: `https://t.me/${bot}?start=${await issueCode(db, actor.userId, actor.organizationId, CODE_TTL_MINUTES)}` };
}

/**
 * Link do Telegram para mandar a outra pessoa pelo WhatsApp: vale 7 dias e uma vez.
 * Usado na aprovação do cadastro e em Ajustes › Usuários.
 */
export async function createTelegramInvite(db: Db, userId: string, organizationId: string, deps: TelegramDeps = {}): Promise<{ url: string; days: number }> {
  const bot = await readyBot(deps.api ?? telegramApi);
  return { url: `https://t.me/${bot}?start=${await issueCode(db, userId, organizationId, INVITE_TTL_MINUTES)}`, days: INVITE_TTL_MINUTES / 60 / 24 };
}

/** Ajustes › Usuários: link do Telegram de uma pessoa da empresa. */
export async function createMemberTelegramLink(db: Db, actor: Actor, membershipId: string, deps: TelegramDeps = {}): Promise<{ url: string; days: number; name: string }> {
  if (!can(actor, "users.manage")) throw forbidden();
  const m = await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { rows } = await tx.query<{ userId: string; name: string; status: string; isOwner: boolean }>(
      `SELECT u.id AS "userId", u.name, m.status, m.is_owner AS "isOwner"
         FROM controle_vendas_estoque.memberships m JOIN controle_vendas_estoque.users u ON u.id = m.user_id
        WHERE m.id = $1 AND m.organization_id = $2`,
      [membershipId, actor.organizationId],
    );
    return rows[0];
  });
  if (!m) throw notFound("Usuário");
  if (m.status !== "active") throw new AppError("conflict", "Ative o acesso antes de gerar o link.");
  if (m.isOwner && !actor.isOwner && m.userId !== actor.userId) throw forbidden("Apenas um proprietário gera link para outro proprietário.");
  const invite = await createTelegramInvite(db, m.userId, actor.organizationId, deps);
  await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    recordAudit(tx, actor, { action: "member.telegram_link", entityType: "membership", entityId: membershipId, summary: `Link do Telegram gerado para ${m.name}` }),
  );
  return { ...invite, name: m.name };
}

export async function unlinkTelegram(db: Db, actor: Actor): Promise<void> {
  await db.query("UPDATE controle_vendas_estoque.telegram_links SET status = 'revoked' WHERE user_id = $1 AND status = 'active'", [actor.userId]);
}

// Webhook ------------------------------------------------------------------------

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: TgMedia;
  audio?: TgMedia & { file_name?: string };
  video_note?: TgMedia;
}

interface TgMedia {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const HOW_TO_LINK =
  "Olá! Eu sou a Netz, a assistente do netzsales.\n\n" +
  "Para conversar comigo por aqui, ligue sua conta: entre no netzsales pelo navegador e toque no botão Telegram, no alto da tela. " +
  "Se alguém da sua empresa já te mandou um link do Telegram, é só tocar nele.";

async function send(api: TelegramApi, chatId: number | string, text: string, markup?: unknown): Promise<number | null> {
  let last: number | null = null;
  const parts: string[] = [];
  for (let rest = text; rest.length > 0; rest = rest.slice(TEXT_LIMIT)) parts.push(rest.slice(0, TEXT_LIMIT));
  for (const [i, part] of parts.entries()) {
    const r = await api.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: part,
      ...(markup && i === parts.length - 1 ? { reply_markup: markup } : {}),
    });
    last = r.message_id;
  }
  return last;
}

async function findLink(db: Db, telegramUserId: number): Promise<LinkRow | null> {
  const { rows } = await db.query<LinkRow>(
    `SELECT user_id AS "userId", organization_id AS "organizationId", chat_id::text AS "chatId", first_name AS "firstName"
       FROM controle_vendas_estoque.telegram_links WHERE telegram_user_id = $1 AND status = 'active'`,
    [telegramUserId],
  );
  return rows[0] ?? null;
}

async function linkActor(db: Db, link: LinkRow): Promise<Actor | null> {
  try {
    const actor = await resolveActor(db, { userId: link.userId, organizationId: link.organizationId, channel: "telegram" });
    // O Telegram também precisa estar liberado para a empresa (Plataforma › Liberações).
    return can(actor, "nets.use") && (await enabledFeatures(db, link.organizationId)).has("telegram") ? actor : null;
  } catch {
    return null;
  }
}

/** Manda para o Telegram as respostas da Netz que ainda não foram entregues, a partir da mensagem dada. */
async function deliver(db: Db, api: TelegramApi, actor: Actor, chatId: string, fromId: string) {
  const owner = { organizationId: actor.organizationId, userId: actor.userId };
  const replies = await withTenant(db, owner, async (tx) => {
    const { rows } = await tx.query<{ id: string; body: string; title: string | null; pending: boolean; cleaned: string[] | null }>(
      `SELECT id, body, action->>'title' AS title, action_status = 'pending' AS pending, cleaned
         FROM controle_vendas_estoque.nets_messages
        WHERE organization_id = $1 AND user_id = $2 AND role = 'assistant' AND telegram_message_id IS NULL AND id <> $3
          AND created_at >= (SELECT created_at FROM controle_vendas_estoque.nets_messages WHERE id = $3)
        ORDER BY created_at, id`,
      [actor.organizationId, actor.userId, fromId],
    );
    return rows;
  });
  // Quem tem mais de uma empresa vê em qual delas a ação vai acontecer.
  const orgs = replies.some((r) => r.title) ? await listUserOrganizations(db, actor.userId) : [];
  const where = orgs.length > 1 ? `[${orgs.find((o) => o.id === actor.organizationId)?.name ?? "empresa"}] ` : "";
  for (const r of replies) {
    const text = r.title ? `${r.body}\n\n👉 ${where}${r.title}` : r.body;
    const markup = r.pending
      ? { inline_keyboard: [[{ text: "✅ Confirmar", callback_data: `nets:c:${r.id}` }, { text: "✖️ Cancelar", callback_data: `nets:x:${r.id}` }]] }
      : undefined;
    // Guarda o texto exato que foi para o Telegram, para a Netz conferir depois (pedido nº 8).
    const record = (status: "sent" | "failed", error: string | null) =>
      withTenant(db, owner, (tx) =>
        tx.query(
          `INSERT INTO controle_vendas_estoque.nets_deliveries (organization_id, user_id, nets_message_id, channel, text, status, error, removed)
           VALUES ($1, $2, $3, 'telegram', $4, $5, $6, $7)`,
          [actor.organizationId, actor.userId, r.id, text, status, error, r.cleaned],
        ),
      ).catch((err) => console.error("nets delivery log failed", err instanceof Error ? err.message : err));
    let sent: number | null;
    try {
      sent = await send(api, chatId, text, markup);
    } catch (err) {
      await record("failed", (err instanceof Error ? err.message : String(err)).slice(0, 500));
      throw err;
    }
    await record("sent", null);
    await withTenant(db, owner, (tx) =>
      tx.query("UPDATE controle_vendas_estoque.nets_messages SET telegram_message_id = $2 WHERE id = $1", [r.id, sent ?? 0]),
    );
  }
}

// Várias empresas -----------------------------------------------------------------
// O Telegram é da pessoa; a empresa em que a Netz trabalha é escolhida por /empresa.

/** Mostra um botão para cada empresa da pessoa (a atual marcada). */
async function chooseOrganization(db: Db, api: TelegramApi, link: LinkRow) {
  const orgs = await listUserOrganizations(db, link.userId);
  if (orgs.length <= 1) {
    await send(api, link.chatId, orgs[0] ? `Você tem só uma empresa: ${orgs[0].name}. Estou trabalhando nela.` : "Não encontrei empresas na sua conta.");
    return;
  }
  const here = orgs.find((o) => o.id === link.organizationId);
  await send(
    api,
    link.chatId,
    `${here ? `Agora estou na empresa ${here.name}.` : "Você ainda não escolheu uma empresa."} Em qual empresa você quer que eu trabalhe?`,
    { inline_keyboard: orgs.map((o) => [{ text: `${o.id === link.organizationId ? "✅ " : ""}${o.name}`, callback_data: `org:${o.id}` }]) },
  );
}

async function onChooseOrganization(db: Db, api: TelegramApi, cb: NonNullable<TelegramUpdate["callback_query"]>, organizationId: string) {
  const answer = (text: string) => api.call("answerCallbackQuery", { callback_query_id: cb.id, text }).catch(() => {});
  const link = await findLink(db, cb.from.id);
  const org = link && (await listUserOrganizations(db, link.userId)).find((o) => o.id === organizationId);
  if (!link || !org) {
    await answer("Essa empresa não está na sua conta.");
    return;
  }
  const actor = await linkActor(db, { ...link, organizationId });
  if (!actor) {
    await answer("Sem acesso à Netz nessa empresa.");
    await send(api, link.chatId, `Na empresa ${org.name} a Netz não está liberada para você. Fale com o dono da empresa.`);
    return;
  }
  await db.query("UPDATE controle_vendas_estoque.telegram_links SET organization_id = $2 WHERE telegram_user_id = $1 AND status = 'active'", [
    cb.from.id,
    organizationId,
  ]);
  if (cb.message) {
    await api.call("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  await answer(org.name);
  await send(api, link.chatId, `Pronto, agora estou na empresa ${org.name}. Tudo o que você pedir vale para ela. Para trocar de novo, envie /empresa.`);
}

async function connect(db: Db, api: TelegramApi, msg: TgMessage, code: string) {
  const from = msg.from!;
  const linked = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; userId: string; organizationId: string }>(
      `SELECT id, user_id AS "userId", organization_id AS "organizationId" FROM controle_vendas_estoque.telegram_link_codes
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hash(code)],
    );
    const c = rows[0];
    if (!c) return null;
    await tx.query("UPDATE controle_vendas_estoque.telegram_link_codes SET used_at = now() WHERE id = $1", [c.id]);
    // Liga de novo: desfaz a ligação anterior desta pessoa e desta conta do Telegram.
    await tx.query(
      "UPDATE controle_vendas_estoque.telegram_links SET status = 'revoked' WHERE status = 'active' AND (user_id = $1 OR telegram_user_id = $2)",
      [c.userId, from.id],
    );
    await tx.query(
      `INSERT INTO controle_vendas_estoque.telegram_links (user_id, organization_id, telegram_user_id, chat_id, username, first_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.userId, c.organizationId, from.id, msg.chat.id, from.username ?? null, from.first_name ?? null],
    );
    return c;
  });
  if (!linked) {
    await send(api, msg.chat.id, "Esse link de conexão já foi usado ou venceu. No netzsales, toque no botão Telegram, no alto da tela, para receber um novo.");
    return;
  }
  const org = await withTenant(db, { organizationId: linked.organizationId, userId: linked.userId }, async (tx) => {
    const { rows } = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.organizations WHERE id = $1", [linked.organizationId]);
    return rows[0]?.name ?? "sua empresa";
  });
  await send(
    api,
    msg.chat.id,
    `Pronto${from.first_name ? `, ${from.first_name}` : ""}! Sua conta está ligada à empresa ${org}.\n\n` +
      "Pode me pedir em texto ou por áudio o que faria no painel: registrar venda, cadastrar produto, ver estoque, lançar custo... " +
      "Antes de mudar qualquer coisa eu mostro o que vou fazer e você confirma.\n\nPara desligar, envie /sair.",
  );
}

/** Baixa o áudio e transcreve. Devolve null quando já avisou a pessoa. */
async function hear(db: Db, owner: { organizationId: string; userId: string }, api: TelegramApi, msg: TgMessage, transcribe?: Transcriber): Promise<string | null> {
  const voice = msg.voice ?? msg.video_note;
  const media = (voice ?? msg.audio)!;
  if (!transcribe && !transcriptionConfigured()) {
    await send(api, msg.chat.id, "Ainda não consigo ouvir áudios por aqui. Por enquanto, mande em texto.");
    return null;
  }
  if ((media.duration ?? 0) > AUDIO_MAX_SECONDS || (media.file_size ?? 0) > AUDIO_MAX_BYTES) {
    await send(api, msg.chat.id, "Esse áudio é longo demais para mim (até 10 minutos). Pode mandar em partes?");
    return null;
  }
  await api.call("sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {});
  const file = await api.call<{ file_path?: string }>("getFile", { file_id: media.file_id });
  if (!file.file_path) throw new Error("Telegram getFile sem file_path");
  const data = await api.download(file.file_path);
  // A voz do Telegram vem como .oga, extensão que a API de transcrição não reconhece.
  const fileName = msg.voice ? "voz.ogg" : msg.video_note ? "video.mp4" : (msg.audio?.file_name ?? file.file_path.split("/").pop() ?? "audio.mp3");
  const audio = { data, fileName, mimeType: msg.voice ? "audio/ogg" : media.mime_type };
  const t = transcribe
    ? { text: await transcribe(audio), provider: "teste", model: "teste", seconds: media.duration ?? 0 }
    : await transcribeAudioDetailed(audio, media.duration);
  await recordTranscriptionUsage(db, owner, "telegram_audio", t);
  const heard = t.text.trim();
  if (!heard) {
    await send(api, msg.chat.id, "Não consegui entender o áudio. Pode repetir ou mandar em texto?");
    return null;
  }
  return heard;
}

async function onMessage(db: Db, api: TelegramApi, update: TelegramUpdate, deps: TelegramDeps) {
  const msg = update.message!;
  if (!msg.from) return;
  if (msg.chat.type !== "private") {
    await send(api, msg.chat.id, "Eu só converso no privado. Abra uma conversa direta comigo.");
    return;
  }
  const text = (msg.text ?? msg.caption ?? "").trim();
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
  if (start?.[1]?.startsWith(SIGNUP_PREFIX)) return connectSignup(db, api, msg, start[1].slice(SIGNUP_PREFIX.length));
  if (start?.[1]) return connect(db, api, msg, start[1]);

  const link = await findLink(db, msg.from.id);
  if (!link) {
    const waiting = await pendingSignup(db, msg.from.id);
    await send(
      api,
      msg.chat.id,
      waiting
        ? `Seu pedido de conta para ${waiting.organizationName} ainda está aguardando aprovação. Eu te aviso aqui assim que for liberado.`
        : HOW_TO_LINK,
    );
    return;
  }
  if (/^\/empresas?\b/i.test(text) || /^(trocar|mudar)( de)? empresa\b/i.test(text)) {
    await chooseOrganization(db, api, link);
    return;
  }
  if (/^\/(sair|desconectar)\b/i.test(text)) {
    await db.query("UPDATE controle_vendas_estoque.telegram_links SET status = 'revoked' WHERE telegram_user_id = $1 AND status = 'active'", [msg.from.id]);
    await send(api, msg.chat.id, "Conta desligada. Para voltar, toque no botão Telegram no painel do netzsales.");
    return;
  }
  const actor = await linkActor(db, link);
  if (!actor) {
    const others = (await listUserOrganizations(db, link.userId)).filter((o) => o.id !== link.organizationId);
    await send(
      api,
      msg.chat.id,
      others.length
        ? "Sua conta não tem mais acesso a essa empresa ou à Netz. Envie /empresa para escolher outra das suas empresas."
        : "Sua conta não tem mais acesso a essa empresa ou à Netz. Fale com quem administra o netzsales.",
    );
    return;
  }
  if (start) {
    const orgs = await listUserOrganizations(db, link.userId);
    const here = orgs.find((o) => o.id === link.organizationId)?.name;
    await send(
      api,
      msg.chat.id,
      `Oi${link.firstName ? `, ${link.firstName}` : ""}! Sua conta já está ligada` +
        (orgs.length > 1 ? `, e agora estou na empresa ${here}. Para trocar, envie /empresa.` : ". É só me dizer o que precisa."),
    );
    return;
  }
  let said = text;
  const spoken = !!(msg.voice ?? msg.audio ?? msg.video_note);
  if (spoken) {
    const heard = await hear(db, { organizationId: link.organizationId, userId: link.userId }, api, msg, deps.transcribe);
    if (heard === null) return;
    // A legenda do áudio, se houver, vai junto.
    said = text ? `${heard}\n\n${text}` : heard;
  }
  if (!said) {
    await send(api, msg.chat.id, "Por enquanto eu entendo texto e áudio. Foto chega em breve.");
    return;
  }

  let posted: { id: string; queued: boolean };
  try {
    posted = await postNetsMessage(db, actor, {
      requestId: stableUuid(`tg:${update.update_id}`),
      text: said.slice(0, 12000),
      context: spoken ? "Telegram, voz transcrita" : "Telegram",
    });
  } catch (err) {
    await send(api, msg.chat.id, err instanceof AppError ? err.message : "Não consegui receber a mensagem. Tente de novo.");
    return;
  }
  if (posted.queued) {
    await api.call("sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {});
    await processNetsTurn(db, { organizationId: actor.organizationId, userId: actor.userId, messageId: posted.id, channel: "telegram" }, { model: deps.model });
  }
  await deliver(db, api, actor, link.chatId, posted.id);
}

async function onCallback(db: Db, api: TelegramApi, update: TelegramUpdate, deps: TelegramDeps) {
  const model = deps.model;
  const cb = update.callback_query!;
  const org = /^org:([0-9a-f-]{36})$/.exec(cb.data ?? "");
  if (org) return onChooseOrganization(db, api, cb, org[1]!);
  const signup = /^signup:([ar]):([0-9a-f-]{36})$/.exec(cb.data ?? "");
  if (signup) return onSignupDecision(db, api, cb, signup[1] === "a", signup[2]!, deps);
  const m = /^nets:([cx]):([0-9a-f-]{36})$/.exec(cb.data ?? "");
  const answer = (text: string) => api.call("answerCallbackQuery", { callback_query_id: cb.id, text }).catch(() => {});
  const link = await findLink(db, cb.from.id);
  const actor = link && (await linkActor(db, link));
  if (!m || !link || !actor) {
    await answer("Não consegui identificar sua conta.");
    return;
  }
  const decision = m[1] === "c" ? "confirm" : "cancel";
  // Tira os botões para não confirmar duas vezes.
  if (cb.message) {
    await api.call("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  let r: { status: string; queued: boolean };
  try {
    r = await decideNetsAction(db, actor, { id: m[2]!, decision });
  } catch (err) {
    await answer(err instanceof AppError ? err.message : "Não deu certo.");
    return;
  }
  await answer(decision === "cancel" ? "Cancelado" : r.status === "done" ? "Feito" : "Deu erro");
  if (decision === "cancel") {
    await send(api, link.chatId, "Cancelado. Nada foi alterado.");
    return;
  }
  if (r.queued) {
    await api.call("sendChatAction", { chat_id: link.chatId, action: "typing" }).catch(() => {});
    await processNetsTurn(db, { organizationId: actor.organizationId, userId: actor.userId, messageId: m[2]!, channel: "telegram" }, { model });
    await deliver(db, api, actor, link.chatId, m[2]!);
  } else {
    await send(api, link.chatId, r.status === "done" ? "Feito." : "A ação deu erro.");
  }
}

/** Trata um update do webhook. Cada update_id é tratado uma vez só. */
export async function handleTelegramUpdate(db: Db, update: TelegramUpdate, deps: TelegramDeps = {}): Promise<void> {
  if (typeof update?.update_id !== "number") return;
  const fresh = await db.query(
    "INSERT INTO controle_vendas_estoque.telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [update.update_id],
  );
  if (!fresh.rowCount) return;
  const api = deps.api ?? telegramApi;
  try {
    if (update.message) await onMessage(db, api, update, deps);
    else if (update.callback_query) await onCallback(db, api, update, deps);
  } catch (err) {
    console.error("telegram update failed", err instanceof Error ? err.message : err);
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chat) await send(api, chat, "Tive um problema para responder agora. Tente de novo em instantes.").catch(() => {});
  }
}
