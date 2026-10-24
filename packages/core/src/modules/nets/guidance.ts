import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import { z } from "zod";
import { AppError, forbidden, notFound, parseInput } from "../../errors.ts";
import { appUrl } from "../../mail.ts";
import { recordAiUsage } from "../../usage.ts";
import { listImprovements, publishImprovementInTx, type ImprovementViewer } from "../improvements/service.ts";
import { NETS_MANUAL_DEFAULT, NETS_RULES } from "./instructions.ts";
import { netsToolCatalog } from "./tools.ts";
import { defaultNetsModel, NETS_MODEL, netsConfigured, type NetsModel } from "./service.ts";

// Comunicação da Netz: o manual de como ela conversa, separado das melhorias
// do sistema. Cada alteração vira uma versão nova (nets_guidance) e a Netz lê
// a mais nova antes de cada resposta. Só o administrador da plataforma muda,
// sempre vendo o antes e depois. Mesmo desenho das instruções da IA do IONPA
// e do AGENTS.md do NetzOS.

export const GUIDANCE_PATH = "/plataforma/comunicacao";
const MAX = 20000;

export interface NetsGuidanceVersion {
  id: number;
  note: string | null;
  source: "edit" | "proposal" | "revert";
  improvementNumber: string | null;
  by: string;
  at: Date;
  size: number;
}

export interface NetsGuidanceCurrent {
  /** null: ainda vale o texto padrão do código. */
  id: number | null;
  body: string;
  by: string | null;
  at: Date | null;
}

/** O manual que a Netz lê agora. */
export async function currentNetsManual(tx: Tx): Promise<NetsGuidanceCurrent> {
  const { rows } = await tx.query<NetsGuidanceCurrent>(
    `SELECT id::int AS id, body, created_by_name AS by, created_at AS at
       FROM controle_vendas_estoque.nets_guidance ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ?? { id: null, body: NETS_MANUAL_DEFAULT, by: null, at: null };
}

function assertDeveloper(viewer: ImprovementViewer) {
  if (!viewer.isDeveloper) throw forbidden("Só o administrador da plataforma muda a comunicação da Netz.");
}

function asViewer<T>(db: Db, viewer: ImprovementViewer, fn: (tx: Tx) => Promise<T>) {
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, fn);
}

export async function netsGuidanceOverview(db: Db, viewer: ImprovementViewer) {
  assertDeveloper(viewer);
  const { current, versions } = await asViewer(db, viewer, async (tx) => {
    const current = await currentNetsManual(tx);
    const { rows } = await tx.query<NetsGuidanceVersion>(
      `SELECT g.id::int AS id, g.note, g.source, i.number::text AS "improvementNumber", g.created_by_name AS by, g.created_at AS at, char_length(g.body) AS size
         FROM controle_vendas_estoque.nets_guidance g
         LEFT JOIN controle_vendas_estoque.improvements i ON i.id = g.improvement_id
        ORDER BY g.id DESC LIMIT 30`,
    );
    return { current, versions: rows };
  });
  const requests = await listImprovements(db, viewer, { module: "comunicacao" });
  const reads = await guidanceReads(db, viewer);
  return { current, defaultBody: NETS_MANUAL_DEFAULT, versions, requests, reads, rules: NETS_RULES, tools: netsToolCatalog() };
}

export interface GuidanceReads {
  /** Respostas que leram esta versão, por canal. */
  web: number;
  telegram: number;
  total: number;
  lastAt: Date | null;
}

/** Quantas respostas da Netz leram cada versão do manual (0 = texto padrão). */
async function guidanceReads(db: Db, viewer: ImprovementViewer): Promise<Record<number, GuidanceReads>> {
  const { rows } = await asViewer(db, viewer, (tx) =>
    tx.query<{ version: string; channel: string; reads: number; lastAt: Date }>(
      `SELECT version::text AS version, channel, reads, last_at AS "lastAt" FROM controle_vendas_estoque.platform_nets_guidance_reads($1)`,
      [viewer.userId],
    ),
  );
  const out: Record<number, GuidanceReads> = {};
  for (const r of rows) {
    const v = (out[Number(r.version)] ??= { web: 0, telegram: 0, total: 0, lastAt: null });
    if (r.channel === "telegram") v.telegram += r.reads;
    else v.web += r.reads;
    v.total += r.reads;
    if (!v.lastAt || r.lastAt > v.lastAt) v.lastAt = r.lastAt;
  }
  return out;
}

/** Uma versão e o texto da anterior (para mostrar o que mudou). A versão 0 é o texto padrão. */
export async function getNetsGuidanceVersion(db: Db, viewer: ImprovementViewer, id: number) {
  assertDeveloper(viewer);
  if (id === 0) return { id: 0, body: NETS_MANUAL_DEFAULT, previous: null as string | null };
  return asViewer(db, viewer, async (tx) => {
    const { rows } = await tx.query<{ id: number; body: string; previous: string | null }>(
      `SELECT g.id::int AS id, g.body,
              (SELECT p.body FROM controle_vendas_estoque.nets_guidance p WHERE p.id < g.id ORDER BY p.id DESC LIMIT 1) AS previous
         FROM controle_vendas_estoque.nets_guidance g WHERE g.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound("Versão");
    return { ...rows[0], previous: rows[0].previous ?? NETS_MANUAL_DEFAULT };
  });
}

const saveInput = z.object({
  body: z.string().trim().min(1, "O manual não pode ficar vazio.").max(MAX, "Use até 20.000 caracteres."),
  note: z.string().trim().max(300).optional(),
  /** Versão que a pessoa estava vendo (null = texto padrão), para não sobrescrever a de outra pessoa. */
  base: z.number().int().positive().nullable(),
  source: z.enum(["edit", "proposal", "revert"]).default("edit"),
  /** Pedido de ajuste (módulo comunicacao) que esta mudança atende: vira publicado. */
  improvementId: z.string().uuid().optional(),
});

export async function saveNetsGuidance(db: Db, viewer: ImprovementViewer, raw: z.input<typeof saveInput>) {
  assertDeveloper(viewer);
  const input = parseInput(saveInput, raw);
  return asViewer(db, viewer, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('nets_guidance'))");
    const current = await currentNetsManual(tx);
    if (input.base !== current.id) throw new AppError("conflict", "O manual mudou enquanto você editava. Recarregue a página.");
    if (input.body === current.body.trim()) throw new AppError("invalid_input", "Nada mudou no manual.");
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO controle_vendas_estoque.nets_guidance (body, note, source, improvement_id, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::int AS id`,
      [input.body, input.note || null, input.source, input.improvementId ?? null, viewer.userId, viewer.userName.slice(0, 120)],
    );
    const id = rows[0]!.id;
    if (input.improvementId) {
      await publishImprovementInTx(
        tx,
        viewer,
        input.improvementId,
        `${appUrl()}${GUIDANCE_PATH}?versao=${id}`,
        `Aplicado no manual de comunicação da Netz (versão ${id}). Ela já segue o novo texto na próxima mensagem.`,
      );
    }
    return { id };
  });
}

/** Volta a uma versão anterior: grava uma versão nova com aquele texto. */
export async function revertNetsGuidance(db: Db, viewer: ImprovementViewer, id: number, base: number | null) {
  const old = await getNetsGuidanceVersion(db, viewer, id);
  return saveNetsGuidance(db, viewer, { body: old.body, base, source: "revert", note: id === 0 ? "Volta ao texto inicial do sistema" : `Volta à versão ${id}` });
}

const PROPOSE_SYSTEM = `Você edita o manual de comunicação da Netz, a assistente de IA do netzsales (sistema de vendas e estoque para pequenas empresas de qualquer ramo). O manual diz como a Netz conversa com as pessoas; regras de segurança e de ferramentas ficam fora dele e não mudam aqui.
Você recebe o manual atual e um pedido de mudança. Devolva o manual inteiro já com a mudança, mexendo só no necessário: mantenha o resto palavra por palavra, o mesmo formato (títulos de seção e linhas começando com "- ") e o português simples. O sistema é genérico: exemplos de um ramo valem como exemplo, nunca como regra só daquele ramo.
Responda só com um objeto JSON, sem texto antes ou depois: {"resumo": "1 ou 2 frases sobre o que mudou", "manual": "texto completo do manual"}`;

const proposeInput = z.object({
  request: z.string().trim().min(3, "Descreva a mudança.").max(3000, "Use até 3.000 caracteres."),
});

/** A IA prepara o texto novo; nada é salvo até o administrador aprovar o antes e depois. */
export async function proposeNetsGuidance(db: Db, viewer: ImprovementViewer, raw: z.input<typeof proposeInput>, model: NetsModel = defaultNetsModel) {
  assertDeveloper(viewer);
  const input = parseInput(proposeInput, raw);
  if (model === defaultNetsModel && !netsConfigured()) {
    throw new AppError("conflict", "Falta a chave da Anthropic (ANTHROPIC_API_KEY) na Vercel para a IA preparar a proposta.");
  }
  const current = await asViewer(db, viewer, currentNetsManual);
  const response = await model({
    model: NETS_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: PROPOSE_SYSTEM,
    messages: [{ role: "user", content: `Manual atual:\n<manual>\n${current.body}\n</manual>\n\nPedido de mudança:\n${input.request}` }],
  });
  await recordAiUsage(db, viewer, "nets_guidance", response.model ?? NETS_MODEL, response.usage);
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let parsed: { resumo?: unknown; manual?: unknown } = {};
  try {
    if (start >= 0 && end > start) parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    parsed = {};
  }
  const proposed = typeof parsed.manual === "string" ? parsed.manual.trim() : "";
  if (!proposed || proposed.length > MAX) throw new AppError("conflict", "A IA não devolveu um manual válido. Tente de novo.");
  return { base: current.id, proposed, summary: typeof parsed.resumo === "string" ? parsed.resumo.trim().slice(0, 600) : "" };
}
