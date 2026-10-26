import Anthropic from "@anthropic-ai/sdk";
import { addAiUsage, emptyAiUsage, recordAiUsage } from "../../usage.ts";
import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import { z } from "zod";
import { can, resolveActor, type Actor, type Channel } from "../../context.ts";
import { AppError, forbidden, parseInput } from "../../errors.ts";
import { runService } from "../../service.ts";
import { agentComplementImprovement, agentCreateImprovement, agentListImprovements } from "../improvements/service.ts";
import { cleanReply } from "./clean.ts";
import { currentNetsManual } from "./guidance.ts";
import { NETS_RULES } from "./instructions.ts";
import { listNetsDeliveries } from "./deliveries.ts";
import { activePersonNotes, agentNotePerson, personNotesText } from "./person.ts";
import { BATCH_LIMIT, BATCH_TOOL, DELIVERIES_TOOL, IMPROVEMENT_COMPLEMENT_TOOL, IMPROVEMENT_LIST_TOOL, IMPROVEMENT_TOOL, netsTools, PERSON_NOTE_TOOL, type NetsTool } from "./tools.ts";

// Netz: o agente global. A conversa fica no banco; cada mensagem da pessoa é
// respondida fora da requisição (processNetsTurn). Consultas rodam na hora;
// ações que mudam dados viram um cartão que a pessoa confirma ou cancela.

export const NETS_MODEL = "claude-opus-5-5";
export const NETS_DAILY_LIMIT = 200;
const MAX_STEPS = 12;
const RESULT_LIMIT = 15000;
const HISTORY = 30;

export type NetsActionStatus = "pending" | "running" | "done" | "failed" | "cancelled" | "expired";

export interface NetsAction {
  tool: string;
  service: string;
  title: string;
  input: Record<string, unknown>;
  /** Lote: a mesma ação para cada item (propor_lote). */
  items?: Record<string, unknown>[];
}

export interface NetsMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  context: string | null;
  status: "queued" | "processing" | "done" | "failed";
  action: Pick<NetsAction, "title" | "service"> | null;
  actionStatus: NetsActionStatus | null;
  actionResult: string | null;
  createdAt: Date;
}

interface Row extends Omit<NetsMessage, "action"> {
  action: NetsAction | null;
}

/** Chamada ao modelo; os testes trocam por uma resposta roteirizada. */
export type NetsModel = (req: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export function netsConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
export const defaultNetsModel: NetsModel = (req) => {
  client ??= new Anthropic();
  // Se o modelo recusar por política, a API tenta de novo num modelo de reserva.
  return client.beta.messages.create({ ...req, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
};

const COLUMNS = `id, role, body, context, status, action, action_status AS "actionStatus", action_result AS "actionResult", created_at AS "createdAt"`;

function asUser<T>(db: Db, actor: Pick<Actor, "organizationId" | "userId">, fn: (tx: Tx) => Promise<T>) {
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, fn);
}

function publicMessage(r: Row): NetsMessage {
  return { ...r, action: r.action ? { title: r.action.title, service: r.action.service } : null };
}

export async function listNetsMessages(db: Db, actor: Actor, limit = 60) {
  if (!can(actor, "nets.use")) throw forbidden();
  return asUser(db, actor, async (tx) => {
    // Resposta presa (a função caiu no meio): libera a conversa.
    const stuck = await tx.query(
      `UPDATE controle_vendas_estoque.nets_messages SET status = 'failed'
        WHERE organization_id = $1 AND user_id = $2 AND status IN ('queued', 'processing') AND updated_at < now() - interval '6 minutes'`,
      [actor.organizationId, actor.userId],
    );
    if (stuck.rowCount) await insertReply(tx, actor, "Demorei demais e parei no meio. Pode mandar de novo?");
    const { rows } = await tx.query<Row>(
      `SELECT ${COLUMNS} FROM controle_vendas_estoque.nets_messages
        WHERE organization_id = $1 AND user_id = $2 ORDER BY created_at DESC, role ASC LIMIT $3`,
      [actor.organizationId, actor.userId, limit],
    );
    const messages = rows.reverse().map(publicMessage);
    return { messages, pending: messages.some((m) => m.status === "queued" || m.status === "processing"), enabled: netsConfigured() };
  });
}

const postInput = z.object({
  requestId: z.string().uuid(),
  text: z.string().trim().min(1, "Escreva a mensagem.").max(12000, "Use até 12.000 caracteres."),
  context: z.string().trim().max(200).nullable().optional(),
});

/** Guarda a mensagem da pessoa. queued: true quando a Netz ainda vai responder. */
export async function postNetsMessage(db: Db, actor: Actor, raw: z.input<typeof postInput>) {
  if (!can(actor, "nets.use")) throw forbidden("Você não tem permissão para conversar com a Netz.");
  const input = parseInput(postInput, raw);
  return asUser(db, actor, async (tx) => {
    const again = await tx.query<{ id: string; status: string }>(
      "SELECT id, status FROM controle_vendas_estoque.nets_messages WHERE user_id = $1 AND request_id = $2",
      [actor.userId, input.requestId],
    );
    if (again.rows[0]) return { id: again.rows[0].id, queued: false };
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`nets:${actor.organizationId}:${actor.userId}`]);
    const busy = await tx.query(
      "SELECT 1 FROM controle_vendas_estoque.nets_messages WHERE organization_id = $1 AND user_id = $2 AND status IN ('queued', 'processing')",
      [actor.organizationId, actor.userId],
    );
    if (busy.rowCount) throw new AppError("conflict", "A Netz ainda está respondendo a mensagem anterior.");
    const today = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM controle_vendas_estoque.nets_messages
        WHERE user_id = $1 AND role = 'user' AND created_at > now() - interval '1 day'`,
      [actor.userId],
    );
    if (today.rows[0]!.n >= NETS_DAILY_LIMIT) throw new AppError("rate_limited", "Limite de mensagens com a Netz por hoje atingido. Tente amanhã.");
    // Nova mensagem: propostas que ficaram sem resposta deixam de valer.
    await tx.query(
      `UPDATE controle_vendas_estoque.nets_messages SET action_status = 'expired'
        WHERE organization_id = $1 AND user_id = $2 AND action_status = 'pending'`,
      [actor.organizationId, actor.userId],
    );
    const enabled = netsConfigured();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.nets_messages (organization_id, user_id, role, body, context, channel, status, request_id)
       VALUES ($1, $2, 'user', $3, $4, $5, $6, $7) RETURNING id`,
      [actor.organizationId, actor.userId, input.text, input.context ?? null, channelOf(actor.channel), enabled ? "queued" : "done", input.requestId],
    );
    if (!enabled) {
      await insertReply(tx, actor, "Ainda não estou ligada nesta instalação: falta cadastrar a chave da Anthropic (ANTHROPIC_API_KEY) na Vercel. Assim que ela entrar, eu respondo por aqui.");
    }
    return { id: rows[0]!.id, queued: enabled };
  });
}

function channelOf(c: Channel): "web" | "telegram" | "whatsapp" {
  return c === "telegram" || c === "whatsapp" ? c : "web";
}

async function insertReply(tx: Tx, actor: Pick<Actor, "organizationId" | "userId">, body: string, action?: NetsAction, status = "done", cleaned: string[] = []) {
  await tx.query(
    `INSERT INTO controle_vendas_estoque.nets_messages (organization_id, user_id, role, body, status, action, action_status, cleaned)
     VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7)`,
    [actor.organizationId, actor.userId, body.slice(0, 20000), status, action ? JSON.stringify(action) : null, action ? "pending" : null, cleaned.length ? cleaned : null],
  );
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}… (cortado)` : text;
}

function serialize(value: unknown): string {
  return clip(JSON.stringify(value ?? null), RESULT_LIMIT);
}

const decideInput = z.object({ id: z.string().uuid(), decision: z.enum(["confirm", "cancel"]) });

/** A pessoa confirma ou cancela a ação proposta. Confirmada, a Netz continua a conversa. */
export async function decideNetsAction(db: Db, actor: Actor, raw: z.input<typeof decideInput>) {
  if (!can(actor, "nets.use")) throw forbidden();
  const input = parseInput(decideInput, raw);
  const claimed = await asUser(db, actor, async (tx) => {
    const { rows } = await tx.query<{ action: NetsAction }>(
      `UPDATE controle_vendas_estoque.nets_messages
          SET action_status = $2, action_decided_at = now()
        WHERE id = $1 AND organization_id = $3 AND user_id = $4 AND action_status = 'pending'
        RETURNING action`,
      [input.id, input.decision === "confirm" ? "running" : "cancelled", actor.organizationId, actor.userId],
    );
    return rows[0]?.action ?? null;
  });
  if (!claimed) throw new AppError("conflict", "Esta proposta não está mais esperando resposta.");
  if (input.decision === "cancel") return { status: "cancelled" as const, queued: false };

  const tool = netsTools(actor).tools.find((t) => t.service.name === claimed.service);
  let status: "done" | "failed" = "done";
  let result: string;
  try {
    if (!tool) throw forbidden("Você não tem mais permissão para esta ação.");
    if (claimed.items) {
      const r = await runBatch(db, actor, tool, input.id, claimed.items);
      if (r.feitos === 0) status = "failed";
      result = serialize(r);
    } else {
      // A chave de idempotência impede repetir a ação num clique duplo.
      result = serialize(await runService(db, tool.service, actor, claimed.input, { idempotencyKey: `nets:${input.id}` }));
    }
  } catch (err) {
    status = "failed";
    result = err instanceof AppError ? err.message : "Erro inesperado ao executar a ação.";
  }
  const queued = netsConfigured();
  await asUser(db, actor, (tx) =>
    tx.query(
      `UPDATE controle_vendas_estoque.nets_messages SET action_status = $2, action_result = $3, status = $4 WHERE id = $1`,
      [input.id, status, clip(result, 20000), queued ? "queued" : "done"],
    ),
  );
  return { status, queued };
}

// Turno da Netz ------------------------------------------------------------------

const STATUS_NOTE: Record<NetsActionStatus, string> = {
  pending: "esperando a pessoa confirmar",
  running: "executando",
  done: "confirmada e executada",
  failed: "confirmada, mas deu erro",
  cancelled: "cancelada pela pessoa",
  expired: "ficou sem resposta",
};

// A hora vai em cada mensagem (e não no topo) para o histórico não mudar de
// um minuto para o outro: assim a conversa já enviada sai do cache, bem mais barata.
function historyText(r: Row, clock: Intl.DateTimeFormat): string {
  if (r.role === "user") return `[${clock.format(r.createdAt)}] ${r.context ? `[Tela: ${r.context}]\n` : ""}${r.body}`;
  if (!r.action) return r.body;
  const result = r.actionResult ? `; resultado: ${clip(r.actionResult, 1500)}` : "";
  return `${r.body}\n\n[Ação proposta: ${r.action.title} — ${STATUS_NOTE[r.actionStatus ?? "expired"]}${result}]`;
}

async function systemPrompt(tx: Tx, actor: Actor): Promise<{ blocks: Anthropic.Beta.BetaTextBlockParam[]; version: number; timezone: string }> {
  const { rows } = await tx.query<{ name: string; today: string; timezone: string }>(
    `SELECT name, timezone, to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today
       FROM controle_vendas_estoque.organizations WHERE id = $1`,
    [actor.organizationId],
  );
  const org = rows[0]!;
  const who = actor.isOwner ? "dona/dono da empresa" : `perfil ${actor.roleKey}`;
  // O manual de comunicação muda pela Plataforma; a versão mais nova vale já na próxima mensagem.
  const manual = await currentNetsManual(tx);
  const notes = await activePersonNotes(tx, actor.organizationId, actor.userId);
  return {
    // Versão 0 = texto padrão do código. Fica gravada na mensagem: prova de que a resposta leu o manual.
    version: manual.id ?? 0,
    timezone: org.timezone,
    blocks: [
      // Ferramentas + regras + manual: igual para a pessoa o dia todo. Cache de 1 hora,
      // porque no Telegram a pessoa costuma demorar mais de 5 minutos entre mensagens.
      { type: "text", text: `${NETS_RULES}\n\n# Manual de comunicação\n\n${manual.body}`, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `Empresa: ${org.name}. Pessoa: ${actor.userName} (${who}). Hoje: ${org.today} (${org.timezone}); a hora de cada mensagem vem no começo dela, entre colchetes.${CHANNEL_NOTE[actor.channel] ?? ""}\n\n${personNotesText(notes)}` },
    ],
  };
}

const CHANNEL_NOTE: Partial<Record<Channel, string>> = {
  telegram:
    " Canal: Telegram. Escreva texto simples, sem tabelas nem markdown (asteriscos, # e | aparecem crus). Mensagens curtas. A confirmação aparece como botões Confirmar e Cancelar logo abaixo da sua resposta.",
};

type ToolOutcome = { content: string; isError?: boolean; action?: NetsAction };

async function runTool(db: Db, actor: Actor, tools: NetsTool[], block: Anthropic.Beta.BetaToolUseBlock, proposed: boolean): Promise<ToolOutcome> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  if (block.name === IMPROVEMENT_TOOL) {
    try {
      const r = await agentCreateImprovement(db, actor, { ...(input as object), channel: actor.channel === "telegram" ? "telegram" : "site" } as Parameters<typeof agentCreateImprovement>[2]);
      return { content: r.existing ? `Já existia um pedido parecido (nº ${r.item.number}); a fala foi juntada a ele.` : `Melhoria registrada: pedido nº ${r.item.number}.` };
    } catch (err) {
      return { content: err instanceof AppError ? err.message : "Não foi possível registrar a melhoria.", isError: true };
    }
  }
  if (block.name === IMPROVEMENT_LIST_TOOL) return { content: serialize(await agentListImprovements(db, actor)) };
  if (block.name === PERSON_NOTE_TOOL) {
    try {
      const n = await agentNotePerson(db, actor, input as Parameters<typeof agentNotePerson>[2]);
      return { content: `Anotado (nota #${n.id}). Não precisa avisar a pessoa; só siga isso daqui para frente.` };
    } catch (err) {
      return { content: err instanceof AppError ? err.message : "Não foi possível anotar.", isError: true };
    }
  }
  if (block.name === DELIVERIES_TOOL) return { content: serialize(await listNetsDeliveries(db, actor, Number(input.limit) || 10)) };
  if (block.name === IMPROVEMENT_COMPLEMENT_TOOL) {
    try {
      const item = await agentComplementImprovement(db, actor, input as Parameters<typeof agentComplementImprovement>[2]);
      return { content: `Complemento registrado no pedido nº ${item.number}.` };
    } catch (err) {
      return { content: err instanceof AppError ? err.message : "Não foi possível complementar a melhoria.", isError: true };
    }
  }
  if (block.name === BATCH_TOOL) return proposeBatch(tools, input, proposed);
  const tool = tools.find((t) => t.name === block.name);
  if (!tool) return { content: "Ferramenta indisponível para esta pessoa.", isError: true };
  const { _resumo, ...args } = input;
  try {
    if (tool.read) return { content: serialize(await runService(db, tool.service, actor, args)) };
    if (proposed) return { content: "Já existe uma ação esperando confirmação neste turno. Proponha uma ação por vez.", isError: true };
    // Valida agora para a Netz corrigir antes de mostrar o cartão.
    parseInput(tool.service.input, args);
    const title = typeof _resumo === "string" && _resumo.trim() ? _resumo.trim().slice(0, 300) : tool.service.description;
    return {
      content: "Proposta pronta: a pessoa vai ver um cartão para confirmar ou cancelar. Termine a resposta dizendo o que vai acontecer; não diga que já foi feito.",
      action: { tool: tool.name, service: tool.service.name, title, input: args },
    };
  } catch (err) {
    return { content: err instanceof AppError ? err.message : "Erro inesperado na ferramenta.", isError: true };
  }
}

function proposeBatch(tools: NetsTool[], input: Record<string, unknown>, proposed: boolean): ToolOutcome {
  const tool = tools.find((t) => t.name === input.ferramenta && !t.read);
  if (!tool) return { content: "Ferramenta indisponível para lote (use uma que muda dados e que a pessoa pode usar).", isError: true };
  if (proposed) return { content: "Já existe uma ação esperando confirmação neste turno. Proponha uma ação por vez.", isError: true };
  const raw = Array.isArray(input.itens) ? input.itens : [];
  if (raw.length === 0 || raw.length > BATCH_LIMIT) return { content: `Mande de 1 a ${BATCH_LIMIT} itens.`, isError: true };
  const items: Record<string, unknown>[] = [];
  const problems: string[] = [];
  raw.forEach((item, i) => {
    const { _resumo, ...args } = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    try {
      parseInput(tool.service.input, args);
      items.push(args);
    } catch (err) {
      problems.push(`item ${i + 1}: ${err instanceof AppError ? err.message : "dados inválidos"}`);
    }
  });
  if (problems.length) return { content: `Corrija antes de propor:\n${problems.slice(0, 10).join("\n")}`, isError: true };
  const title = typeof input._resumo === "string" && input._resumo.trim() ? input._resumo.trim().slice(0, 300) : `${tool.service.description} (${items.length} itens)`;
  return {
    content: `Proposta pronta: um cartão só para os ${items.length} itens. Termine a resposta dizendo o que vai acontecer; não diga que já foi feito.`,
    action: { tool: tool.name, service: tool.service.name, title, input: {}, items },
  };
}

/** Roda o lote confirmado item por item; um erro não para os outros. */
async function runBatch(db: Db, actor: Actor, tool: NetsTool, messageId: string, items: Record<string, unknown>[]) {
  let ok = 0;
  const falhas: Array<{ item: number; erro: string }> = [];
  for (const [i, item] of items.entries()) {
    try {
      await runService(db, tool.service, actor, item, { idempotencyKey: `nets:${messageId}:${i}` });
      ok++;
    } catch (err) {
      falhas.push({ item: i + 1, erro: err instanceof AppError ? err.message : "erro inesperado" });
    }
  }
  return { total: items.length, feitos: ok, falhas };
}

/**
 * Responde a pessoa: a mensagem dela (role user) ou a continuação depois de
 * uma ação confirmada (role assistant com status queued).
 */
export async function processNetsTurn(
  db: Db,
  params: { organizationId: string; userId: string; messageId: string; channel?: Channel },
  deps: { model?: NetsModel } = {},
): Promise<void> {
  const owner = { organizationId: params.organizationId, userId: params.userId };
  const trigger = await asUser(db, owner, async (tx) => {
    const { rows } = await tx.query<Row>(
      `UPDATE controle_vendas_estoque.nets_messages SET status = 'processing'
        WHERE id = $1 AND status = 'queued' RETURNING ${COLUMNS}`,
      [params.messageId],
    );
    return rows[0] ?? null;
  });
  if (!trigger) return;

  const finish = (body: string | null, action?: NetsAction, cleaned: string[] = []) =>
    asUser(db, owner, async (tx) => {
      if (body !== null) await insertReply(tx, owner, body, action, "done", cleaned);
      await tx.query("UPDATE controle_vendas_estoque.nets_messages SET status = 'done' WHERE id = $1", [trigger.id]);
    });

  let actor: Actor;
  try {
    actor = await resolveActor(db, { ...owner, channel: params.channel ?? "web" });
  } catch {
    await finish("Você não tem mais acesso a esta empresa.");
    return;
  }
  if (!can(actor, "nets.use")) {
    await finish("Você não tem permissão para conversar com a Netz. Peça a quem administra a empresa.");
    return;
  }

  try {
    const { history, system, timezone } = await asUser(db, owner, async (tx) => {
      const { rows } = await tx.query<Row>(
        `SELECT ${COLUMNS} FROM controle_vendas_estoque.nets_messages
          WHERE organization_id = $1 AND user_id = $2 AND created_at <= (SELECT created_at FROM controle_vendas_estoque.nets_messages WHERE id = $3)
          ORDER BY created_at DESC, role ASC LIMIT $4`,
        [owner.organizationId, owner.userId, trigger.id, HISTORY],
      );
      const prompt = await systemPrompt(tx, actor);
      await tx.query("UPDATE controle_vendas_estoque.nets_messages SET guidance_version = $2 WHERE id = $1", [trigger.id, prompt.version]);
      return { history: rows.reverse(), system: prompt.blocks, timezone: prompt.timezone };
    });
    const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const r of history) {
      if (messages.length === 0 && r.role !== "user") continue;
      messages.push({ role: r.role, content: historyText(r, clock) });
    }
    if (trigger.role === "assistant") {
      const ok = trigger.actionStatus === "done";
      messages.push({
        role: "user",
        content: ok
          ? "[sistema] A pessoa confirmou a ação acima e ela foi executada (veja o resultado). Diga em poucas palavras o que foi feito e, se o pedido tinha mais passos, siga para o próximo."
          : "[sistema] A pessoa confirmou a ação acima, mas ela deu erro (veja o resultado). Explique em palavras simples e, se der, proponha a correção.",
      });
    }
    if (messages.length === 0) {
      await finish(null);
      return;
    }

    const { tools } = netsTools(actor);
    let definitions = netsTools(actor, { lazy: true }).definitions;
    const model = deps.model ?? defaultNetsModel;
    const texts: string[] = [];
    const cleaned: string[] = [];
    let action: NetsAction | undefined;
    const used = emptyAiUsage();
    let usedModel: string = NETS_MODEL;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const request = (defs: typeof definitions) => model({
          model: NETS_MODEL,
          max_tokens: 16000,
          output_config: { effort: "medium" },
          // Cache automático até a última mensagem: o próximo passo e a próxima
          // mensagem pagam só o que é novo.
          cache_control: { type: "ephemeral" },
          system,
          tools: defs,
          messages,
        });
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await request(definitions);
        } catch (err) {
          // Se a API recusar a busca de ferramentas, segue com todas abertas (mais caro, mas responde).
          if (!(err instanceof Anthropic.BadRequestError) || definitions.every((d) => !("defer_loading" in d))) throw err;
          console.error("nets tool search refused", err.message);
          definitions = netsTools(actor).definitions;
          response = await request(definitions);
        }
        addAiUsage(used, response.usage);
        usedModel = response.model ?? usedModel;
        for (const b of response.content) {
          if (b.type !== "text") continue;
          const c = cleanReply(b.text);
          cleaned.push(...c.removed);
          if (c.text.trim()) texts.push(c.text.trim());
        }
        if (response.stop_reason === "refusal") {
          texts.push("Não posso ajudar com isso.");
          break;
        }
        if (response.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (response.stop_reason !== "tool_use" || uses.length === 0) break;
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const use of uses) {
          const out = await runTool(db, actor, tools, use, !!action);
          if (out.action) action = out.action;
          results.push({ type: "tool_result", tool_use_id: use.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: results });
      }
    } finally {
      if (used.input_tokens || used.output_tokens) await recordAiUsage(db, owner, "netz", usedModel, used);
    }
    const body = texts.join("\n\n") || (action ? action.title : "Pronto.");
    await finish(body, action, cleaned);
  } catch (err) {
    console.error("nets turn failed", err instanceof Error ? err.message : err);
    await finish("Não consegui responder agora. Tente de novo em instantes.");
  }
}
