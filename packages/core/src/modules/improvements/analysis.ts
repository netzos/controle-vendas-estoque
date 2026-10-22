import type { Db } from "@erp/db";
import { withTenant } from "@erp/db";
import { AppError, forbidden } from "../../errors.ts";
import { defaultNetsModel, NETS_MODEL, netsConfigured, type NetsModel } from "../nets/service.ts";
import { IMPROVEMENT_MODULES, type ImprovementViewer } from "./service.ts";

// Análise da IA sobre todos os pedidos abertos da plataforma: sugere quais
// juntar, resume o que cada empresa precisa e aponta prioridades. Só sugere;
// quem junta e decide é o desenvolvedor.

export interface ImprovementAnalysis {
  id: string;
  createdAt: Date;
  items: number;
  result: {
    resumo: string;
    grupos: Array<{ titulo: string; numeros: number[]; motivo: string }>;
    necessidades: Array<{ empresa: string; resumo: string }>;
    prioridades: Array<{ numero: number; motivo: string }>;
  };
}

const SYSTEM = `Você ajuda o administrador do netzsales, um sistema de vendas e estoque usado por pequenas empresas de ramos diferentes, a organizar os pedidos de melhoria dos clientes.
Responda só com um objeto JSON, sem texto antes ou depois, no formato:
{"resumo": "2 a 4 frases sobre o conjunto", "grupos": [{"titulo": "...", "numeros": [12, 15], "motivo": "por que são a mesma necessidade"}], "necessidades": [{"empresa": "nome", "resumo": "o que essa empresa mais precisa, em 1 a 3 frases"}], "prioridades": [{"numero": 12, "motivo": "..."}]}
Regras: só agrupe pedidos que resolvem a mesma necessidade (mínimo 2 números por grupo). O primeiro número de cada grupo é o que deve ficar como principal (o mais completo). Prioridades: até 5, as que mais empresas pedem ou que mais destravam o uso. O sistema é genérico, nunca sob medida para um ramo. Português do Brasil, frases simples.`;

function assertDeveloper(viewer: ImprovementViewer) {
  if (!viewer.isDeveloper) throw forbidden("Só o administrador da plataforma usa a análise.");
}

export async function latestImprovementAnalysis(db: Db, viewer: ImprovementViewer): Promise<ImprovementAnalysis | null> {
  assertDeveloper(viewer);
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, async (tx) => {
    const { rows } = await tx.query<ImprovementAnalysis>(
      `SELECT id, created_at AS "createdAt", items, result FROM controle_vendas_estoque.improvement_analyses ORDER BY created_at DESC LIMIT 1`,
    );
    return rows[0] ?? null;
  });
}

function parseResult(text: string): ImprovementAnalysis["result"] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AppError("conflict", "A IA não devolveu uma análise válida. Tente de novo.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError("conflict", "A IA não devolveu uma análise válida. Tente de novo.");
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const nums = (v: unknown) => arr(v).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return {
    resumo: str(raw.resumo, 2000),
    grupos: arr(raw.grupos)
      .map((g: any) => ({ titulo: str(g?.titulo, 200), numeros: nums(g?.numeros), motivo: str(g?.motivo, 600) }))
      .filter((g) => g.numeros.length >= 2)
      .slice(0, 30),
    necessidades: arr(raw.necessidades)
      .map((n: any) => ({ empresa: str(n?.empresa, 120), resumo: str(n?.resumo, 1000) }))
      .filter((n) => n.empresa && n.resumo)
      .slice(0, 100),
    prioridades: arr(raw.prioridades)
      .map((p: any) => ({ numero: Number(p?.numero), motivo: str(p?.motivo, 600) }))
      .filter((p) => Number.isInteger(p.numero) && p.numero > 0)
      .slice(0, 5),
  };
}

export async function analyzeImprovementsWithAI(db: Db, viewer: ImprovementViewer, model: NetsModel = defaultNetsModel): Promise<ImprovementAnalysis> {
  assertDeveloper(viewer);
  if (model === defaultNetsModel && !netsConfigured()) {
    throw new AppError("conflict", "Falta a chave da Anthropic (ANTHROPIC_API_KEY) na Vercel para a IA analisar.");
  }
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, async (tx) => {
    const { rows } = await tx.query<{ number: string; title: string; body: string; module: string; organizationName: string | null; status: string }>(
      `SELECT number::text AS number, title, left(body, 1500) AS body, module, organization_name AS "organizationName", status
         FROM controle_vendas_estoque.improvements
        WHERE merged_into IS NULL AND status IN ('new', 'analysis', 'approved')
        ORDER BY number LIMIT 200`,
    );
    if (rows.length === 0) throw new AppError("conflict", "Não há pedidos em aberto para analisar.");
    const moduleLabel = (k: string) => IMPROVEMENT_MODULES.find((m) => m.key === k)?.label ?? k;
    const list = rows
      .map((r) => `#${r.number} [${moduleLabel(r.module)}] [${r.organizationName ?? "sugestão do desenvolvimento"}] ${r.title}\n${r.body}`)
      .join("\n\n---\n\n");
    const response = await model({
      model: NETS_MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Pedidos em aberto (${rows.length}):\n\n${list}` }],
    });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const result = parseResult(text);
    const valid = new Set(rows.map((r) => Number(r.number)));
    result.grupos = result.grupos
      .map((g) => ({ ...g, numeros: [...new Set(g.numeros.filter((n) => valid.has(n)))] }))
      .filter((g) => g.numeros.length >= 2);
    result.prioridades = result.prioridades.filter((p) => valid.has(p.numero));
    const saved = await tx.query<ImprovementAnalysis>(
      `INSERT INTO controle_vendas_estoque.improvement_analyses (created_by, result, items) VALUES ($1, $2, $3)
       RETURNING id, created_at AS "createdAt", items, result`,
      [viewer.userId, JSON.stringify(result), rows.length],
    );
    return saved.rows[0]!;
  });
}

/** Acha o pedido pelo número (a análise fala em números). */
export async function improvementIdByNumber(db: Db, viewer: ImprovementViewer, number: number): Promise<string | null> {
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.improvements WHERE number = $1", [number]);
    return rows[0]?.id ?? null;
  });
}
