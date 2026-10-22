import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@erp/db";
import { withTenant, withTransaction } from "@erp/db";
import { can, resolveActor, type Actor } from "../../context.ts";
import { enabledFeatures } from "../../features.ts";
import { AppError, forbidden } from "../../errors.ts";
import { appUrl } from "../../mail.ts";
import { transcribeAudioDetailed, transcriptionConfigured, type Transcriber } from "../../transcribe.ts";
import { recordTranscriptionUsage } from "../../usage.ts";
import { decideNetsAction, postNetsMessage, processNetsTurn, type NetsModel } from "../nets/service.ts";
import { telegramApi, telegramConfigured, telegramWebhookSecret, type TelegramApi } from "./api.ts";

// Netz no Telegram. Um robô da plataforma atende todo mundo; a pessoa liga a
// própria conta pelo painel (código de uso único no link t.me/robo?start=...)
// e a conversa é a mesma do balão do painel, com as mesmas permissões.

const CODE_TTL_MINUTES = 15;
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

export async function getTelegramStatus(db: Db, actor: Actor): Promise<TelegramStatus> {
  if (!can(actor, "nets.use")) throw forbidden();
  const { rows } = await db.query<NonNullable<TelegramStatus["link"]>>(
    `SELECT username, first_name AS "firstName", organization_id AS "organizationId", created_at AS "createdAt"
       FROM controle_vendas_estoque.telegram_links WHERE user_id = $1 AND status = 'active'`,
    [actor.userId],
  );
  return { configured: telegramConfigured(), link: rows[0] ?? null };
}

/** Link do botão "Conectar": abre o robô com um código que vale uma vez, por 15 minutos. */
export async function createTelegramLink(db: Db, actor: Actor, deps: TelegramDeps = {}): Promise<{ url: string }> {
  if (!can(actor, "nets.use")) throw forbidden("Você não tem permissão para conversar com a Netz.");
  if (!telegramConfigured()) throw new AppError("invalid_input", "O robô do Telegram ainda não foi ligado (falta TELEGRAM_BOT_TOKEN na Vercel).");
  const api = deps.api ?? telegramApi;
  let bot: string;
  try {
    await ensureWebhook(api);
    bot = await botUsername(api);
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
  const code = randomBytes(18).toString("base64url");
  await withTransaction(db, async (tx) => {
    await tx.query("UPDATE controle_vendas_estoque.telegram_link_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [actor.userId]);
    await tx.query(
      `INSERT INTO controle_vendas_estoque.telegram_link_codes (user_id, organization_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [actor.userId, actor.organizationId, hash(code), CODE_TTL_MINUTES],
    );
  });
  return { url: `https://t.me/${bot}?start=${code}` };
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
  "Para conversar comigo por aqui, ligue sua conta: entre no netzsales pelo navegador, abra Assistente › Telegram e toque em Conectar.";

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
  const replies = await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { rows } = await tx.query<{ id: string; body: string; title: string | null; pending: boolean }>(
      `SELECT id, body, action->>'title' AS title, action_status = 'pending' AS pending
         FROM controle_vendas_estoque.nets_messages
        WHERE organization_id = $1 AND user_id = $2 AND role = 'assistant' AND telegram_message_id IS NULL AND id <> $3
          AND created_at >= (SELECT created_at FROM controle_vendas_estoque.nets_messages WHERE id = $3)
        ORDER BY created_at, id`,
      [actor.organizationId, actor.userId, fromId],
    );
    return rows;
  });
  for (const r of replies) {
    const text = r.title ? `${r.body}\n\n👉 ${r.title}` : r.body;
    const markup = r.pending
      ? { inline_keyboard: [[{ text: "✅ Confirmar", callback_data: `nets:c:${r.id}` }, { text: "✖️ Cancelar", callback_data: `nets:x:${r.id}` }]] }
      : undefined;
    const sent = await send(api, chatId, text, markup);
    await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
      tx.query("UPDATE controle_vendas_estoque.nets_messages SET telegram_message_id = $2 WHERE id = $1", [r.id, sent ?? 0]),
    );
  }
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
    await send(api, msg.chat.id, "Esse link de conexão já foi usado ou venceu. No netzsales, abra Assistente › Telegram e toque em Conectar de novo.");
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
  if (start?.[1]) return connect(db, api, msg, start[1]);

  const link = await findLink(db, msg.from.id);
  if (!link) {
    await send(api, msg.chat.id, HOW_TO_LINK);
    return;
  }
  if (/^\/(sair|desconectar)\b/i.test(text)) {
    await db.query("UPDATE controle_vendas_estoque.telegram_links SET status = 'revoked' WHERE telegram_user_id = $1 AND status = 'active'", [msg.from.id]);
    await send(api, msg.chat.id, "Conta desligada. Para voltar, use Conectar no painel do netzsales.");
    return;
  }
  const actor = await linkActor(db, link);
  if (!actor) {
    await send(api, msg.chat.id, "Sua conta não tem mais acesso a essa empresa ou à Netz. Fale com quem administra o netzsales.");
    return;
  }
  if (start) {
    await send(api, msg.chat.id, `Oi${link.firstName ? `, ${link.firstName}` : ""}! Sua conta já está ligada. É só me dizer o que precisa.`);
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

async function onCallback(db: Db, api: TelegramApi, update: TelegramUpdate, model?: NetsModel) {
  const cb = update.callback_query!;
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
    else if (update.callback_query) await onCallback(db, api, update, deps.model);
  } catch (err) {
    console.error("telegram update failed", err instanceof Error ? err.message : err);
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chat) await send(api, chat, "Tive um problema para responder agora. Tente de novo em instantes.").catch(() => {});
  }
}
