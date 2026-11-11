import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@erp/db";
import { withTenant, withTransaction } from "@erp/db";
import { can, resolveActor, type Actor } from "../../context.ts";
import { enabledFeatures } from "../../features.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { recordAudit } from "../../audit.ts";
import { listUserOrganizations } from "../../auth/session.ts";
import { transcribeAudioDetailed, transcriptionConfigured, type Transcriber } from "../../transcribe.ts";
import { recordTranscriptionUsage } from "../../usage.ts";
import { decideNetsAction, postNetsMessage, processNetsTurn, type NetsModel } from "../nets/service.ts";
import { gowaApi, isPrivateJid, isStaticsPath, whatsappConfigured, whatsappDeviceId, type WhatsAppApi, type WhatsAppStatus } from "./gowa.ts";

// Netz no WhatsApp, pelo QR Code (como o NetzOS). Um número da plataforma atende
// todo mundo, no papel do robô do Telegram. A pessoa liga a própria conta
// tocando no botão WhatsApp do painel: a conversa abre com um código escrito,
// ela envia e pronto. Daí em diante é a mesma Netz do balão e do Telegram,
// com as mesmas permissões. O WhatsApp por QR não tem botões, então a
// confirmação é respondendo SIM ou NÃO.

const CODE_TTL_MINUTES = 15;
const INVITE_TTL_MINUTES = 7 * 24 * 60;
const TEXT_LIMIT = 4000;
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const CODE_PREFIX = "NS-";
const CODE_RE = /\bNS-([A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/;
const YES = /^(sim|s|confirmo|confirmar|confirma|pode|pode sim|ok|isso|isso mesmo|fechado|manda)[.!]*$/i;
const NO = /^(n[aã]o|n|cancela|cancelar|cancelo|deixa|esquece)[.!]*$/i;
const CONFIRM_HINT = "Responda SIM para confirmar ou NÃO para cancelar.";

export interface WhatsAppDeps {
  api?: WhatsAppApi;
  model?: NetsModel;
  transcribe?: Transcriber;
}

const hash = (code: string) => createHash("sha256").update(code).digest();

function stableUuid(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function assertDeveloper(db: Db, userId: string) {
  const { rows } = await db.query<{ dev: boolean }>("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [userId]);
  if (!rows[0]?.dev) throw forbidden();
}

// Plataforma › WhatsApp ----------------------------------------------------------

export interface WhatsAppPlatformStatus extends WhatsAppStatus {
  configured: boolean;
  /** Mensagem quando a ponte não respondeu. */
  error: string | null;
  linkedPeople: number;
}

/** Estado do número da plataforma. Só o administrador da plataforma vê. */
export async function getWhatsAppPlatformStatus(db: Db, actor: Actor, deps: WhatsAppDeps = {}): Promise<WhatsAppPlatformStatus> {
  await assertDeveloper(db, actor.userId);
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM controle_vendas_estoque.whatsapp_links WHERE status = 'active'");
  const linkedPeople = rows[0]?.n ?? 0;
  if (!whatsappConfigured()) return { configured: false, connected: false, loggedIn: false, phone: null, error: null, linkedPeople };
  try {
    return { configured: true, ...(await (deps.api ?? gowaApi).status()), error: null, linkedPeople };
  } catch (err) {
    console.error("whatsapp status", err);
    return { configured: true, connected: false, loggedIn: false, phone: null, error: "A ponte do WhatsApp não respondeu. Confira se o servidor está ligado.", linkedPeople };
  }
}

/** Gera o QR Code para ler no celular (WhatsApp › Aparelhos conectados). */
export async function createWhatsAppQr(db: Db, actor: Actor, deps: WhatsAppDeps = {}): Promise<{ image: string; expiresIn: number }> {
  await assertDeveloper(db, actor.userId);
  if (!whatsappConfigured()) throw new AppError("invalid_input", "A ponte do WhatsApp ainda não foi ligada (faltam as variáveis WHATSAPP_ na Vercel).");
  const api = deps.api ?? gowaApi;
  const s = await api.status().catch(() => null);
  if (s?.loggedIn) throw new AppError("conflict", "O WhatsApp já está conectado.");
  try {
    return await api.loginQr();
  } catch (err) {
    console.error("whatsapp qr", err);
    throw new AppError("invalid_input", "A ponte do WhatsApp não gerou o QR Code. Confira se o servidor está ligado e tente de novo.");
  }
}

/** Desconecta o número da plataforma. Ligações das pessoas ficam guardadas para quando voltar. */
export async function disconnectWhatsApp(db: Db, actor: Actor, deps: WhatsAppDeps = {}): Promise<void> {
  await assertDeveloper(db, actor.userId);
  await (deps.api ?? gowaApi).logout();
}

/** Número conectado (só dígitos), ou erro amigável quando o WhatsApp não está pronto. */
async function platformPhone(api: WhatsAppApi): Promise<string> {
  if (!whatsappConfigured()) throw new AppError("invalid_input", "O WhatsApp do netzsales ainda não foi ligado.");
  const s = await api.status().catch(() => null);
  if (!s?.loggedIn || !s.phone) throw new AppError("invalid_input", "O WhatsApp do netzsales está desconectado agora. Avise quem administra o netzsales.");
  return s.phone;
}

// Ligação de cada pessoa -----------------------------------------------------------

export interface WhatsAppPersonStatus {
  configured: boolean;
  link: { phone: string; pushName: string | null; organizationId: string; createdAt: Date } | null;
}

export async function getWhatsAppStatus(db: Db, actor: Actor): Promise<WhatsAppPersonStatus> {
  if (!can(actor, "nets.use")) throw forbidden();
  const { rows } = await db.query<NonNullable<WhatsAppPersonStatus["link"]>>(
    `SELECT phone, push_name AS "pushName", organization_id AS "organizationId", created_at AS "createdAt"
       FROM controle_vendas_estoque.whatsapp_links WHERE user_id = $1 AND status = 'active'`,
    [actor.userId],
  );
  return { configured: whatsappConfigured(), link: rows[0] ?? null };
}

/** Em qual empresa o WhatsApp da pessoa está trabalhando (null = não ligado). */
export async function whatsappOrganizationOf(db: Db, userId: string): Promise<string | null> {
  return (await findLinkByUser(db, userId))?.organizationId ?? null;
}

/** Pessoas desta empresa com o WhatsApp ligado. */
export async function listWhatsAppLinkedUsers(db: Db, actor: Actor): Promise<Set<string>> {
  const { rows } = await db.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM controle_vendas_estoque.whatsapp_links WHERE organization_id = $1 AND status = 'active'`,
    [actor.organizationId],
  );
  return new Set(rows.map((r) => r.userId));
}

async function issueCode(db: Db, userId: string, organizationId: string, minutes: number): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await withTransaction(db, async (tx) => {
    await tx.query("UPDATE controle_vendas_estoque.whatsapp_link_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await tx.query(
      `INSERT INTO controle_vendas_estoque.whatsapp_link_codes (user_id, organization_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [userId, organizationId, hash(code), minutes],
    );
  });
  return code;
}

const chatUrl = (phone: string, text?: string) => `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
const linkText = (code: string) => `Quero ligar meu WhatsApp ao netzsales. Código: ${CODE_PREFIX}${code}`;

/** Botão WhatsApp do painel: já ligado abre a conversa; senão abre com o código escrito (vale 15 minutos). */
export async function createWhatsAppLink(db: Db, actor: Actor, deps: WhatsAppDeps = {}): Promise<{ url: string }> {
  if (!can(actor, "nets.use")) throw forbidden("Você não tem permissão para conversar com a Netz.");
  const phone = await platformPhone(deps.api ?? gowaApi);
  return { url: chatUrl(phone, linkText(await issueCode(db, actor.userId, actor.organizationId, CODE_TTL_MINUTES))) };
}

/** Conversa com a Netz no WhatsApp, sem código (para quem já está ligado). */
export async function whatsappChatUrl(deps: WhatsAppDeps = {}): Promise<string> {
  return chatUrl(await platformPhone(deps.api ?? gowaApi));
}

/** Link para mandar a outra pessoa: vale 7 dias e uma vez. */
export async function createWhatsAppInvite(db: Db, userId: string, organizationId: string, deps: WhatsAppDeps = {}): Promise<{ url: string; days: number }> {
  const phone = await platformPhone(deps.api ?? gowaApi);
  return { url: chatUrl(phone, linkText(await issueCode(db, userId, organizationId, INVITE_TTL_MINUTES))), days: INVITE_TTL_MINUTES / 60 / 24 };
}

/** Ajustes › Usuários: link do WhatsApp de uma pessoa da empresa. */
export async function createMemberWhatsAppLink(db: Db, actor: Actor, membershipId: string, deps: WhatsAppDeps = {}): Promise<{ url: string; days: number; name: string }> {
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
  const invite = await createWhatsAppInvite(db, m.userId, actor.organizationId, deps);
  await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    recordAudit(tx, actor, { action: "member.whatsapp_link", entityType: "membership", entityId: membershipId, summary: `Link do WhatsApp gerado para ${m.name}` }),
  );
  return { ...invite, name: m.name };
}

export async function unlinkWhatsApp(db: Db, actor: Actor): Promise<void> {
  await db.query("UPDATE controle_vendas_estoque.whatsapp_links SET status = 'revoked' WHERE user_id = $1 AND status = 'active'", [actor.userId]);
}

/** Painel: faz a Netz do WhatsApp trabalhar na empresa escolhida. */
export async function setWhatsAppOrganization(db: Db, actor: Actor, organizationId: string, deps: WhatsAppDeps = {}): Promise<{ name: string }> {
  const link = await findLinkByUser(db, actor.userId);
  if (!link) throw new AppError("conflict", "Seu WhatsApp ainda não está ligado.");
  const org = (await listUserOrganizations(db, actor.userId)).find((o) => o.id === organizationId);
  if (!org) throw notFound("Empresa");
  if (link.organizationId === organizationId) return { name: org.name };
  if (!(await linkActor(db, { ...link, organizationId }))) throw forbidden(`Na empresa ${org.name} a Netz não está liberada para você.`);
  await db.query("UPDATE controle_vendas_estoque.whatsapp_links SET organization_id = $2 WHERE user_id = $1 AND status = 'active'", [actor.userId, organizationId]);
  await notifyWhatsApp(link.jid, `Agora estou na empresa ${org.name} (trocada pelo painel). Para trocar de novo, escreva "empresa".`, deps);
  return { name: org.name };
}

/** Avisa no WhatsApp (aprovação de cadastro etc.). Falha só fica no log. Devolve se enviou. */
export async function notifyWhatsApp(jidOrPhone: string, text: string, deps: WhatsAppDeps = {}): Promise<boolean> {
  if (!whatsappConfigured() && !deps.api) return false;
  const jid = jidOrPhone.includes("@") ? jidOrPhone : `${jidOrPhone.replace(/\D/g, "")}@s.whatsapp.net`;
  try {
    await send(deps.api ?? gowaApi, jid, text);
    return true;
  } catch (err) {
    console.error("whatsapp notify failed", err instanceof Error ? err.message : err);
    return false;
  }
}

// Aviso da ponte (webhook) ----------------------------------------------------------

/** Formato do aviso do GOWA v9 (o mesmo que o NetzOS lê). */
export interface WhatsAppEvent {
  event?: string;
  device_id?: string;
  session_id?: string;
  payload?: {
    id?: string;
    chat_id?: string;
    from?: string;
    from_lid?: string;
    from_name?: string;
    sender_display_name?: string;
    body?: string;
    is_from_me?: boolean;
    audio?: unknown;
    image?: unknown;
    video?: unknown;
    document?: unknown;
    sticker?: unknown;
  };
}

interface LinkRow {
  userId: string;
  organizationId: string;
  jid: string;
  pushName: string | null;
}

const LINK_COLUMNS = `user_id AS "userId", organization_id AS "organizationId", jid, push_name AS "pushName"`;

async function findLink(db: Db, jid: string): Promise<LinkRow | null> {
  const { rows } = await db.query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM controle_vendas_estoque.whatsapp_links WHERE jid = $1 AND status = 'active'`, [jid]);
  return rows[0] ?? null;
}

async function findLinkByUser(db: Db, userId: string): Promise<LinkRow | null> {
  const { rows } = await db.query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM controle_vendas_estoque.whatsapp_links WHERE user_id = $1 AND status = 'active'`, [userId]);
  return rows[0] ?? null;
}

async function linkActor(db: Db, link: LinkRow): Promise<Actor | null> {
  try {
    const actor = await resolveActor(db, { userId: link.userId, organizationId: link.organizationId, channel: "whatsapp" });
    return can(actor, "nets.use") && (await enabledFeatures(db, link.organizationId)).has("whatsapp") ? actor : null;
  } catch {
    return null;
  }
}

async function send(api: WhatsAppApi, jid: string, text: string): Promise<void> {
  for (let rest = text; rest.length > 0; rest = rest.slice(TEXT_LIMIT)) await api.send(jid, rest.slice(0, TEXT_LIMIT));
}

const HOW_TO_LINK =
  "Olá! Eu sou a Netz, a assistente do netzsales.\n\n" +
  "Para conversar comigo por aqui, ligue seu WhatsApp: entre no netzsales pelo navegador e toque no botão do WhatsApp, no alto da tela. " +
  "Se alguém da sua empresa já te mandou um link do WhatsApp, é só tocar nele e enviar a mensagem que aparecer.";

/** O caminho do arquivo que a ponte baixou (texto puro ou { path, caption }). */
function mediaPath(raw: unknown): { path: string | null; caption: string } {
  const value = typeof raw === "string" ? { path: raw } : raw && typeof raw === "object" ? (raw as { path?: unknown; caption?: unknown }) : {};
  const path = typeof value.path === "string" ? value.path.trim().replace(/^\/+/, "") : "";
  const caption = typeof (value as { caption?: unknown }).caption === "string" ? String((value as { caption: string }).caption).trim() : "";
  return { path: isStaticsPath(path) ? path : null, caption };
}

async function connect(db: Db, api: WhatsAppApi, jid: string, pushName: string | null, code: string) {
  const linked = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; userId: string; organizationId: string }>(
      `SELECT id, user_id AS "userId", organization_id AS "organizationId" FROM controle_vendas_estoque.whatsapp_link_codes
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hash(code)],
    );
    const c = rows[0];
    if (!c) return null;
    await tx.query("UPDATE controle_vendas_estoque.whatsapp_link_codes SET used_at = now() WHERE id = $1", [c.id]);
    // Liga de novo: desfaz a ligação anterior desta pessoa e deste número.
    await tx.query("UPDATE controle_vendas_estoque.whatsapp_links SET status = 'revoked' WHERE status = 'active' AND (user_id = $1 OR jid = $2)", [c.userId, jid]);
    await tx.query(
      `INSERT INTO controle_vendas_estoque.whatsapp_links (user_id, organization_id, jid, phone, push_name) VALUES ($1, $2, $3, $4, $5)`,
      [c.userId, c.organizationId, jid, jid.split("@")[0], pushName],
    );
    return c;
  });
  if (!linked) {
    await send(api, jid, "Esse código já foi usado ou venceu. No netzsales, toque no botão do WhatsApp, no alto da tela, para receber um novo.");
    return;
  }
  const org = await withTenant(db, { organizationId: linked.organizationId, userId: linked.userId }, async (tx) => {
    const { rows } = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.organizations WHERE id = $1", [linked.organizationId]);
    return rows[0]?.name ?? "sua empresa";
  });
  await send(
    api,
    jid,
    `Pronto${pushName ? `, ${pushName.split(" ")[0]}` : ""}! Seu WhatsApp está ligado à empresa ${org}.\n\n` +
      "Pode me pedir em texto ou por áudio o que faria no painel: registrar venda, cadastrar produto, ver estoque, lançar custo... " +
      `Antes de mudar qualquer coisa eu mostro o que vou fazer e você responde SIM ou NÃO.\n\nPara desligar, escreva "sair".`,
  );
}

/** Manda as respostas da Netz que ainda não foram para o WhatsApp, a partir da mensagem dada. */
async function deliver(db: Db, api: WhatsAppApi, actor: Actor, jid: string, fromId: string) {
  const owner = { organizationId: actor.organizationId, userId: actor.userId };
  const replies = await withTenant(db, owner, async (tx) => {
    const { rows } = await tx.query<{ id: string; body: string; title: string | null; pending: boolean; cleaned: string[] | null }>(
      `SELECT id, body, action->>'title' AS title, action_status = 'pending' AS pending, cleaned
         FROM controle_vendas_estoque.nets_messages
        WHERE organization_id = $1 AND user_id = $2 AND role = 'assistant' AND whatsapp_sent_at IS NULL AND id <> $3
          AND created_at >= (SELECT created_at FROM controle_vendas_estoque.nets_messages WHERE id = $3)
        ORDER BY created_at, id`,
      [actor.organizationId, actor.userId, fromId],
    );
    return rows;
  });
  const orgs = replies.some((r) => r.title) ? await listUserOrganizations(db, actor.userId) : [];
  const where = orgs.length > 1 ? `[${orgs.find((o) => o.id === actor.organizationId)?.name ?? "empresa"}] ` : "";
  for (const r of replies) {
    const text = r.title ? `${r.body}\n\n👉 ${where}${r.title}${r.pending ? `\n\n${CONFIRM_HINT}` : ""}` : r.body;
    const record = (status: "sent" | "failed", error: string | null) =>
      withTenant(db, owner, (tx) =>
        tx.query(
          `INSERT INTO controle_vendas_estoque.nets_deliveries (organization_id, user_id, nets_message_id, channel, text, status, error, removed)
           VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7)`,
          [actor.organizationId, actor.userId, r.id, text, status, error, r.cleaned],
        ),
      ).catch((err) => console.error("nets delivery log failed", err instanceof Error ? err.message : err));
    try {
      await send(api, jid, text);
    } catch (err) {
      await record("failed", (err instanceof Error ? err.message : String(err)).slice(0, 500));
      throw err;
    }
    await record("sent", null);
    await withTenant(db, owner, (tx) => tx.query("UPDATE controle_vendas_estoque.nets_messages SET whatsapp_sent_at = now() WHERE id = $1", [r.id]));
  }
}

/** Proposta da Netz que ainda espera SIM ou NÃO desta pessoa nesta empresa. */
async function pendingAction(db: Db, actor: Actor): Promise<string | null> {
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM controle_vendas_estoque.nets_messages
        WHERE organization_id = $1 AND user_id = $2 AND role = 'assistant' AND action_status = 'pending'
        ORDER BY created_at DESC LIMIT 1`,
      [actor.organizationId, actor.userId],
    );
    return rows[0]?.id ?? null;
  });
}

async function decide(db: Db, api: WhatsAppApi, actor: Actor, jid: string, id: string, confirm: boolean, deps: WhatsAppDeps) {
  let r: { status: string; queued: boolean };
  try {
    r = await decideNetsAction(db, actor, { id, decision: confirm ? "confirm" : "cancel" });
  } catch (err) {
    await send(api, jid, err instanceof AppError ? err.message : "Não deu certo.");
    return;
  }
  // A proposta já foi respondida: não manda de novo.
  await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    tx.query("UPDATE controle_vendas_estoque.nets_messages SET whatsapp_sent_at = coalesce(whatsapp_sent_at, now()) WHERE id = $1", [id]),
  );
  if (!confirm) {
    await send(api, jid, "Cancelado. Nada foi alterado.");
    return;
  }
  if (r.queued) {
    await api.typing(jid, true).catch(() => {});
    await processNetsTurn(db, { organizationId: actor.organizationId, userId: actor.userId, messageId: id, channel: "whatsapp" }, { model: deps.model });
    await api.typing(jid, false).catch(() => {});
    await deliver(db, api, actor, jid, id);
  } else {
    await send(api, jid, r.status === "done" ? "Feito." : "A ação deu erro.");
  }
}

async function chooseOrganization(db: Db, api: WhatsAppApi, link: LinkRow, pick: number | null) {
  const orgs = await listUserOrganizations(db, link.userId);
  if (orgs.length <= 1) {
    await send(api, link.jid, orgs[0] ? `Você tem só uma empresa: ${orgs[0].name}. Estou trabalhando nela.` : "Não encontrei empresas na sua conta.");
    return;
  }
  const chosen = pick ? orgs[pick - 1] : undefined;
  if (!chosen) {
    const here = orgs.find((o) => o.id === link.organizationId);
    await send(
      api,
      link.jid,
      `${here ? `Agora estou na empresa ${here.name}.` : "Você ainda não escolheu uma empresa."} Para trocar, escreva "empresa" e o número:\n\n` +
        orgs.map((o, i) => `${i + 1}. ${o.name}${o.id === link.organizationId ? " (atual)" : ""}`).join("\n") +
        `\n\nExemplo: empresa 2`,
    );
    return;
  }
  if (!(await linkActor(db, { ...link, organizationId: chosen.id }))) {
    await send(api, link.jid, `Na empresa ${chosen.name} a Netz não está liberada para você. Fale com o dono da empresa.`);
    return;
  }
  await db.query("UPDATE controle_vendas_estoque.whatsapp_links SET organization_id = $2 WHERE jid = $1 AND status = 'active'", [link.jid, chosen.id]);
  await send(api, link.jid, `Pronto, agora estou na empresa ${chosen.name}. Tudo o que você pedir vale para ela.`);
}

async function hear(db: Db, owner: { organizationId: string; userId: string }, api: WhatsAppApi, jid: string, path: string | null, transcribe?: Transcriber): Promise<string | null> {
  if (!transcribe && !transcriptionConfigured()) {
    await send(api, jid, "Ainda não consigo ouvir áudios por aqui. Por enquanto, mande em texto.");
    return null;
  }
  if (!path) {
    await send(api, jid, "Não consegui abrir esse áudio. Pode mandar de novo ou escrever?");
    return null;
  }
  await api.typing(jid, true).catch(() => {});
  const file = await api.download(path);
  if (file.data.byteLength > AUDIO_MAX_BYTES) {
    await send(api, jid, "Esse áudio é longo demais para mim (até 10 minutos). Pode mandar em partes?");
    return null;
  }
  const audio = { data: file.data, fileName: path.split("/").pop() || "audio.ogg", mimeType: file.mimeType ?? "audio/ogg" };
  const t = transcribe ? { text: await transcribe(audio), provider: "teste", model: "teste", seconds: 0 } : await transcribeAudioDetailed(audio);
  await recordTranscriptionUsage(db, owner, "whatsapp_audio", t);
  const heard = t.text.trim();
  if (!heard) {
    await send(api, jid, "Não consegui entender o áudio. Pode repetir ou mandar em texto?");
    return null;
  }
  return heard;
}

async function onMessage(db: Db, api: WhatsAppApi, event: WhatsAppEvent, deps: WhatsAppDeps) {
  const p = event.payload!;
  const jid = (p.from ?? "").trim();
  const pushName = (p.sender_display_name || p.from_name || "").trim() || null;
  const text = (p.body ?? "").trim();
  const code = CODE_RE.exec(text);
  if (code) return connect(db, api, jid, pushName, code[1]!);

  const link = await findLink(db, jid);
  if (!link) {
    await send(api, jid, HOW_TO_LINK);
    return;
  }
  const empresa = /^\/?(empresas?|trocar( de)? empresa|mudar( de)? empresa)(\s+(\d{1,2}))?$/i.exec(text);
  if (empresa) return chooseOrganization(db, api, link, empresa[5] ? Number(empresa[5]) : null);
  if (/^\/?(sair|desconectar|desligar)$/i.test(text)) {
    await db.query("UPDATE controle_vendas_estoque.whatsapp_links SET status = 'revoked' WHERE jid = $1 AND status = 'active'", [jid]);
    await send(api, jid, "WhatsApp desligado. Para voltar, toque no botão do WhatsApp no painel do netzsales.");
    return;
  }
  const actor = await linkActor(db, link);
  if (!actor) {
    const others = (await listUserOrganizations(db, link.userId)).filter((o) => o.id !== link.organizationId);
    await send(
      api,
      jid,
      others.length
        ? 'Sua conta não tem mais acesso a essa empresa ou à Netz no WhatsApp. Escreva "empresa" para escolher outra das suas empresas.'
        : "Sua conta não tem mais acesso a essa empresa ou à Netz no WhatsApp. Fale com quem administra o netzsales.",
    );
    return;
  }

  // SIM ou NÃO responde a proposta que está esperando.
  if (YES.test(text) || NO.test(text)) {
    const pending = await pendingAction(db, actor);
    if (pending) return decide(db, api, actor, jid, pending, YES.test(text), deps);
  }

  let said = text;
  const spoken = p.audio !== undefined && p.audio !== null;
  if (spoken) {
    const heard = await hear(db, { organizationId: actor.organizationId, userId: actor.userId }, api, jid, mediaPath(p.audio).path, deps.transcribe);
    if (heard === null) return;
    said = heard;
  } else if (p.image || p.video || p.document || p.sticker) {
    if (!text) {
      await send(api, jid, "Por enquanto eu entendo texto e áudio. Foto chega em breve.");
      return;
    }
    said = mediaPath(p.image).caption || text;
  }
  if (!said) return;

  let posted: { id: string; queued: boolean };
  try {
    posted = await postNetsMessage(db, actor, {
      requestId: stableUuid(`wa:${p.id}`),
      text: said.slice(0, 12000),
      context: spoken ? "WhatsApp, voz transcrita" : "WhatsApp",
    });
  } catch (err) {
    await send(api, jid, err instanceof AppError ? err.message : "Não consegui receber a mensagem. Tente de novo.");
    return;
  }
  if (posted.queued) {
    await api.typing(jid, true).catch(() => {});
    try {
      await processNetsTurn(db, { organizationId: actor.organizationId, userId: actor.userId, messageId: posted.id, channel: "whatsapp" }, { model: deps.model });
    } finally {
      await api.typing(jid, false).catch(() => {});
    }
  }
  await deliver(db, api, actor, jid, posted.id);
}

/**
 * Trata um aviso da ponte (a assinatura já foi conferida na rota).
 * Só conversas privadas com número de telefone; grupos, mensagens do próprio
 * número e outros aparelhos são ignorados. Cada mensagem é tratada uma vez.
 */
export async function handleWhatsAppEvent(db: Db, event: WhatsAppEvent, deps: WhatsAppDeps = {}): Promise<void> {
  const p = event?.payload;
  if (event?.event !== "message" || !p?.id || p.is_from_me) return;
  const device = event.session_id || event.device_id;
  if (device && device !== whatsappDeviceId()) return;
  const from = (p.from ?? "").trim();
  const chat = (p.chat_id ?? "").trim();
  if (!isPrivateJid(from) || (chat !== from && !(chat.endsWith("@lid") && chat === (p.from_lid ?? "").trim()))) return;
  // Eventos técnicos sem conteúdo não entram.
  if (!(p.body ?? "").trim() && !p.audio && !p.image && !p.video && !p.document && !p.sticker) return;
  const fresh = await db.query("INSERT INTO controle_vendas_estoque.whatsapp_events (message_id) VALUES ($1) ON CONFLICT DO NOTHING", [`${device ?? ""}:${p.id}`]);
  if (!fresh.rowCount) return;
  const api = deps.api ?? gowaApi;
  try {
    await onMessage(db, api, event, deps);
  } catch (err) {
    console.error("whatsapp message failed", err instanceof Error ? err.message : err);
    await api.typing(from, false).catch(() => {});
    await send(api, from, "Tive um problema para responder agora. Tente de novo em instantes.").catch(() => {});
  }
}
