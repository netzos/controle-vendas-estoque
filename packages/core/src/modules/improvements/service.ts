import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import { z } from "zod";
import type { Actor } from "../../context.ts";
import { AppError, forbidden, notFound, parseInput } from "../../errors.ts";

// Melhorias: pedidos de mudança no próprio ERP, cada um com uma conversa entre
// quem usa o sistema, a IA do ERP e o Claude, que desenvolve. Mesmo fluxo do
// NetzOS e do IONPA. Só desenvolvedores da plataforma aprovam ou recusam; o
// Claude analisa e leva adiante o que foi aprovado, mas nunca decide.

export const IMPROVEMENT_MODULES = [
  { key: "geral", label: "Geral" },
  { key: "comercial", label: "Comercial" },
  { key: "catalogo", label: "Catálogo" },
  { key: "estoque", label: "Estoque" },
  { key: "compras", label: "Compras" },
  { key: "financeiro", label: "Financeiro" },
  { key: "inteligencia", label: "Inteligência" },
  { key: "assistente", label: "Assistente IA" },
  { key: "automacoes", label: "Automações" },
  { key: "administracao", label: "Administração" },
] as const;

export type ImprovementModule = (typeof IMPROVEMENT_MODULES)[number]["key"];
export type ImprovementStatus = "new" | "analysis" | "approved" | "building" | "published" | "rejected";
export type ImprovementSource = "site" | "telegram" | "erp_ai" | "claude";
export type AuthorKind = "person" | "erp_ai" | "claude";

export const AI_NAME = "IA do ERP";
export const CLAUDE_NAME = "Claude";
export const AGENT_DAILY_LIMIT = 20;
const OPEN: ImprovementStatus[] = ["new", "analysis", "approved", "building"];

export interface ImprovementDetails {
  fala_original?: string;
  problema: string;
  proposta: string;
  criterios?: string[];
}

export interface Improvement {
  id: string;
  number: string;
  organizationId: string | null;
  organizationName: string | null;
  title: string;
  body: string;
  module: ImprovementModule;
  status: ImprovementStatus;
  source: ImprovementSource;
  details: ImprovementDetails | null;
  createdBy: string | null;
  createdByName: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  link: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  messages: number;
  last: { kind: AuthorKind; name: string; at: Date } | null;
}

export interface ImprovementMessage {
  id: string;
  kind: AuthorKind;
  name: string;
  body: string;
  at: Date;
}

// Quem está olhando o quadro. Desenvolvedor é um papel da plataforma, não da
// empresa: vem de controle_vendas_estoque.platform_developers, nunca de perfil ou formulário.
export interface ImprovementViewer {
  userId: string;
  userName: string;
  organizationId: string;
  isDeveloper: boolean;
}

const moduleKey = z.enum(IMPROVEMENT_MODULES.map((m) => m.key) as [ImprovementModule, ...ImprovementModule[]]);
const title = z.string().trim().min(3, "Dê um título ao pedido (mínimo de 3 caracteres).").max(200);
const body = z.string().trim().min(1, "Descreva o pedido.").max(5000, "Use até 5.000 caracteres.");
const message = z.string().trim().min(1, "Escreva a mensagem.").max(5000, "Use até 5.000 caracteres.");

const ITEM_SELECT = `
  SELECT i.id, i.number, i.organization_id AS "organizationId", i.organization_name AS "organizationName",
         i.title, i.body, i.module, i.status, i.source, i.details,
         i.created_by AS "createdBy", i.created_by_name AS "createdByName",
         i.decided_by AS "decidedBy", i.decided_by_name AS "decidedByName", i.decided_at AS "decidedAt", i.link, i.version,
         i.created_at AS "createdAt", i.updated_at AS "updatedAt",
         (SELECT count(*)::int FROM controle_vendas_estoque.improvement_messages m WHERE m.improvement_id = i.id) AS messages,
         (SELECT json_build_object('kind', m.author_kind, 'name', m.author_name, 'at', m.created_at)
            FROM controle_vendas_estoque.improvement_messages m WHERE m.improvement_id = i.id
           ORDER BY m.created_at DESC LIMIT 1) AS last
    FROM controle_vendas_estoque.improvements i`;

export async function improvementViewer(db: Db, actor: Actor): Promise<ImprovementViewer> {
  const { rows } = await db.query<{ dev: boolean }>("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [actor.userId]);
  return { userId: actor.userId, userName: actor.userName, organizationId: actor.organizationId, isDeveloper: rows[0]!.dev };
}

function asViewer<T>(db: Db, viewer: ImprovementViewer, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, fn);
}

function asClaude<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(db, { organizationId: null, userId: null, platformActor: "claude" }, fn);
}

async function load(tx: Tx, id: string, lock = false): Promise<Improvement> {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Pedido");
  if (lock) await tx.query("SELECT 1 FROM controle_vendas_estoque.improvements WHERE id = $1 FOR UPDATE", [id]);
  const { rows } = await tx.query<Improvement>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw notFound("Pedido");
  return rows[0];
}

async function messages(tx: Tx, id: string): Promise<ImprovementMessage[]> {
  const { rows } = await tx.query<ImprovementMessage>(
    `SELECT id, author_kind AS kind, author_name AS name, body, created_at AS at
       FROM controle_vendas_estoque.improvement_messages WHERE improvement_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return rows;
}

async function addMessage(tx: Tx, id: string, kind: AuthorKind, authorId: string | null, name: string, text: string) {
  await tx.query(
    `INSERT INTO controle_vendas_estoque.improvement_messages (improvement_id, author_kind, author_id, author_name, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, kind, authorId, clip(name, 120), clip(text, 5000)],
  );
  await tx.query("UPDATE controle_vendas_estoque.improvements SET updated_at = now() WHERE id = $1", [id]);
}

// Atualização com controle de versão: se outra pessoa alterou o pedido nesse
// meio-tempo, a alteração é recusada em vez de sobrescrever.
async function save(tx: Tx, item: Improvement, expectedVersion: number) {
  const r = await tx.query(
    `UPDATE controle_vendas_estoque.improvements
        SET title = $3, body = $4, module = $5, status = $6, details = $7, link = $8,
            decided_by = $9, decided_by_name = $10, decided_at = $11,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2`,
    [
      item.id,
      expectedVersion,
      item.title,
      item.body,
      item.module,
      item.status,
      item.details ? JSON.stringify(item.details) : null,
      item.link,
      item.decidedBy,
      item.decidedByName,
      item.decidedAt,
    ],
  );
  if (r.rowCount === 0) throw new AppError("conflict", "O pedido foi alterado por outra pessoa. Atualize a página.");
}

// Leitura -------------------------------------------------------------------

export interface ImprovementFilters {
  status?: ImprovementStatus[];
  module?: ImprovementModule;
}

export async function listImprovements(db: Db, viewer: ImprovementViewer, filters: ImprovementFilters = {}) {
  return asViewer(db, viewer, (tx) => queryList(tx, filters));
}

async function queryList(tx: Tx, filters: ImprovementFilters) {
  const { rows } = await tx.query<Improvement>(
    `${ITEM_SELECT}
      WHERE ($1::text[] IS NULL OR i.status = ANY($1))
        AND ($2::text IS NULL OR i.module = $2)
      ORDER BY i.updated_at DESC
      LIMIT 300`,
    [filters.status ?? null, filters.module ?? null],
  );
  return rows;
}

export async function getImprovement(db: Db, viewer: ImprovementViewer, id: string) {
  return asViewer(db, viewer, async (tx) => ({ item: await load(tx, id), messages: await messages(tx, id) }));
}

// Pedido pelo painel ---------------------------------------------------------

const createInput = z.object({ title, body, module: moduleKey.default("geral") });

export async function createImprovement(db: Db, viewer: ImprovementViewer, raw: z.input<typeof createInput>) {
  const input = parseInput(createInput, raw);
  return asViewer(db, viewer, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.improvements (organization_id, organization_name, title, body, module, source, created_by, created_by_name)
       VALUES ($1, (SELECT name FROM controle_vendas_estoque.organizations WHERE id = $1), $2, $3, $4, 'site', $5, $6) RETURNING id`,
      [viewer.organizationId, input.title, input.body, input.module, viewer.userId, clip(viewer.userName, 120)],
    );
    return load(tx, rows[0]!.id);
  });
}

export async function commentImprovement(db: Db, viewer: ImprovementViewer, id: string, text: string) {
  const bodyText = parseInput(message, text);
  return asViewer(db, viewer, async (tx) => {
    await load(tx, id);
    await addMessage(tx, id, "person", viewer.userId, viewer.userName, bodyText);
  });
}

// Correção do pedido antes da decisão: título, texto e partes. O módulo pode
// mudar a qualquer momento. A conversa registra o que mudou, para o Claude
// revisar a análise na próxima conferência.
const editInput = z.object({
  title: title.optional(),
  body: body.optional(),
  module: moduleKey.optional(),
  problem: z.string().trim().max(1500).optional(),
  proposal: z.string().trim().max(2000).optional(),
  criteria: z.array(z.string().trim().max(300)).max(6).optional(),
  comment: z.string().trim().max(2000).optional(),
});

export async function editImprovement(db: Db, viewer: ImprovementViewer, id: string, raw: z.input<typeof editInput>) {
  const input = parseInput(editInput, raw);
  return asViewer(db, viewer, async (tx) => {
    const item = await load(tx, id, true);
    if (!viewer.isDeveloper && item.createdBy !== viewer.userId) {
      throw forbidden("Só quem fez o pedido ou o desenvolvedor pode corrigi-lo.");
    }
    const expected = item.version;
    const changed = applyEdit(item, input);
    const note = editNote(changed, input.comment ?? "");
    if (!note) throw new AppError("invalid_input", "Nada foi alterado.");
    if (changed.length) await save(tx, item, expected);
    await addMessage(tx, id, "person", viewer.userId, viewer.userName, note);
    return load(tx, id);
  });
}

// Decisão: só desenvolvedores da plataforma, pelo painel.
export async function decideImprovement(
  db: Db,
  viewer: ImprovementViewer,
  id: string,
  decision: "approve" | "reject",
  note = "",
) {
  if (!viewer.isDeveloper) throw forbidden("Somente o desenvolvedor aprova ou recusa pedidos.");
  if (decision !== "approve" && decision !== "reject") throw new AppError("invalid_input", "Decisão inválida.");
  return asViewer(db, viewer, async (tx) => {
    const item = await load(tx, id, true);
    if (item.status !== "new" && item.status !== "analysis") throw new AppError("conflict", "Este pedido já foi decidido.");
    const expected = item.version;
    item.status = decision === "approve" ? "approved" : "rejected";
    item.decidedBy = viewer.userId;
    item.decidedByName = clip(viewer.userName, 120);
    item.decidedAt = new Date();
    await save(tx, item, expected);
    const text = (decision === "approve" ? "Aprovado." : "Recusado.") + (note.trim() ? " " + clip(note, 1000) : "");
    await addMessage(tx, id, "person", viewer.userId, viewer.userName, text);
    return load(tx, id);
  });
}

// Pedido registrado pela IA do ERP (Fase do assistente) ----------------------

const agentInput = z.object({
  title,
  module: moduleKey.default("geral"),
  // "suggestion": a pessoa pediu. "noticed": a IA percebeu uma lacuna na conversa.
  kind: z.enum(["suggestion", "noticed"]),
  channel: z.enum(["telegram", "site"]).default("telegram"),
  original: z.string().trim().max(1500).optional(),
  problem: z.string().trim().min(1).max(1500),
  proposal: z.string().trim().min(1).max(2000),
  criteria: z.array(z.string().trim().max(300)).max(6).optional(),
});

// Um pedido aberto com o mesmo título recebe uma mensagem em vez de virar outro pedido.
export async function agentCreateImprovement(db: Db, actor: Actor, raw: z.input<typeof agentInput>) {
  const input = parseInput(agentInput, raw);
  const details = newDetails(input.original, input.problem, input.proposal, input.criteria);
  const text = composeBody(details);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM controle_vendas_estoque.improvements WHERE lower(title) = lower($1) AND status = ANY($2) LIMIT 1`,
      [input.title, OPEN],
    );
    if (existing.rows[0]) {
      await addMessage(tx, existing.rows[0].id, "erp_ai", null, AI_NAME, `Pedido parecido de ${actor.userName}: ${text}`);
      return { item: await load(tx, existing.rows[0].id), existing: true };
    }
    const today = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM controle_vendas_estoque.improvements
        WHERE created_by = $1 AND source IN ('telegram', 'erp_ai') AND created_at > now() - interval '1 day'`,
      [actor.userId],
    );
    if (today.rows[0]!.n >= AGENT_DAILY_LIMIT) {
      throw new AppError("rate_limited", "Muitos pedidos registrados hoje. Tente amanhã.");
    }
    const suggestion = input.kind === "suggestion";
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.improvements (organization_id, organization_name, title, body, module, source, details, created_by, created_by_name)
       VALUES ($1, (SELECT name FROM controle_vendas_estoque.organizations WHERE id = $1), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        actor.organizationId,
        input.title,
        text,
        input.module,
        suggestion ? (input.channel === "site" ? "site" : "telegram") : "erp_ai",
        JSON.stringify(details),
        actor.userId,
        suggestion ? clip(actor.userName, 120) : AI_NAME,
      ],
    );
    if (!suggestion) {
      await addMessage(tx, rows[0]!.id, "erp_ai", null, AI_NAME, `Percebido numa conversa com ${actor.userName}.`);
    }
    return { item: await load(tx, rows[0]!.id), existing: false };
  });
}

// Lado do Claude ---------------------------------------------------------------
// Usado pela rota /api/claude/improvements e pelo comando pnpm improvements.

export const CLAUDE_MOVES: Partial<Record<ImprovementStatus, ImprovementStatus[]>> = {
  analysis: ["new"],
  building: ["approved"],
  published: ["building"],
};

export async function claudeListImprovements(db: Db, filters: ImprovementFilters = {}) {
  return asClaude(db, (tx) => queryList(tx, filters));
}

export async function claudeGetImprovement(db: Db, id: string) {
  return asClaude(db, async (tx) => ({ item: await load(tx, id), messages: await messages(tx, id) }));
}

export async function claudeCommentImprovement(db: Db, id: string, text: string) {
  const bodyText = parseInput(message, text);
  return asClaude(db, async (tx) => {
    await load(tx, id);
    await addMessage(tx, id, "claude", null, CLAUDE_NAME, bodyText);
  });
}

export async function claudeMoveImprovement(
  db: Db,
  id: string,
  status: ImprovementStatus,
  opts: { link?: string; body?: string } = {},
) {
  const from = CLAUDE_MOVES[status];
  if (!from) throw new AppError("invalid_input", "O Claude só move pedidos para análise, desenvolvimento ou publicado.");
  const link = opts.link?.trim() || null;
  if (status === "published" && (!link || !link.startsWith("https://") || link.length > 500)) {
    throw new AppError("invalid_input", "Para publicar, informe o link https:// da mudança.");
  }
  const text = opts.body?.trim() ? parseInput(message, opts.body) : null;
  return asClaude(db, async (tx) => {
    const item = await load(tx, id, true);
    if (!from.includes(item.status)) {
      throw new AppError("conflict", `Não é possível ir de "${item.status}" para "${status}".`);
    }
    const expected = item.version;
    item.status = status;
    if (link) item.link = link;
    await save(tx, item, expected);
    if (text) await addMessage(tx, id, "claude", null, CLAUDE_NAME, text);
    return load(tx, id);
  });
}

export async function claudeCreateImprovement(db: Db, raw: z.input<typeof createInput>) {
  const input = parseInput(createInput, raw);
  return asClaude(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.improvements (title, body, module, source, created_by_name)
       VALUES ($1, $2, $3, 'claude', $4) RETURNING id`,
      [input.title, input.body, input.module, CLAUDE_NAME],
    );
    return load(tx, rows[0]!.id);
  });
}

// Partes do pedido -----------------------------------------------------------

function newDetails(original: string | undefined, problem: string, proposal: string, criteria: string[] = []): ImprovementDetails {
  const d: ImprovementDetails = { problema: problem.trim(), proposta: proposal.trim() };
  const crit = criteria.map((c) => clip(c, 300)).filter(Boolean).slice(0, 6);
  if (crit.length) d.criterios = crit;
  if (original?.trim()) d.fala_original = clip(original, 1500);
  if (!d.problema || !d.proposta) throw new AppError("invalid_input", "Informe o problema e a proposta.");
  return d;
}

// Texto legível do pedido com partes, guardado em body para que painel,
// comando do Claude e auditoria leiam a mesma coisa.
export function composeBody(d: ImprovementDetails): string {
  let text = `Problema (por quê)\n${d.problema}\n\nProposta\n${d.proposta}`;
  if (d.criterios?.length) text += `\n\nComo saber que ficou pronto${d.criterios.map((c) => `\n- ${c}`).join("")}`;
  if (d.fala_original) text += `\n\nFala original\n"${d.fala_original}"`;
  return clip(text, 5000);
}

function applyEdit(item: Improvement, input: z.output<typeof editInput>): string[] {
  const changed: string[] = [];
  if (input.module && input.module !== item.module) {
    item.module = input.module;
    changed.push("módulo");
  }
  const content =
    input.title !== undefined || input.body !== undefined || input.problem !== undefined ||
    input.proposal !== undefined || input.criteria !== undefined;
  if (!content) return changed;
  if (item.status !== "new" && item.status !== "analysis") {
    throw new AppError("conflict", "O pedido já foi decidido; o texto não pode mais ser corrigido. Escreva na conversa.");
  }
  if (input.title !== undefined && input.title !== item.title) {
    item.title = input.title;
    changed.push("título");
  }
  if (input.problem !== undefined || input.proposal !== undefined || input.criteria !== undefined) {
    const d = item.details ?? { problema: "", proposta: "" };
    const next = newDetails(
      d.fala_original,
      input.problem ?? d.problema,
      input.proposal ?? d.proposta,
      input.criteria ?? d.criterios,
    );
    if (next.problema !== d.problema) changed.push("problema");
    if (next.proposta !== d.proposta) changed.push("proposta");
    if (JSON.stringify(next.criterios ?? []) !== JSON.stringify(d.criterios ?? [])) changed.push("critérios");
    item.details = next;
    item.body = composeBody(next);
  } else if (input.body !== undefined && input.body !== item.body) {
    item.body = input.body;
    item.details = null;
    changed.push("descrição");
  }
  return changed;
}

function editNote(changed: string[], comment: string): string {
  const parts: string[] = [];
  if (changed.length) parts.push(`Pedido corrigido: ${changed.join(", ")}.`);
  if (comment.trim()) parts.push(clip(comment, 2000));
  return parts.join(" ");
}

function clip(v: string, n: number): string {
  return [...v.trim()].slice(0, n).join("");
}
