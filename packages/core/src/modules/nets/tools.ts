import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { can, type Actor } from "../../context.ts";
import type { ServiceDefinition } from "../../service.ts";
import * as members from "../access/members.ts";
import * as roles from "../access/roles.ts";
import * as audit from "../audit/service.ts";
import * as customFields from "../catalog/custom-fields.ts";
import * as images from "../catalog/images.ts";
import * as remove from "../catalog/remove.ts";
import * as parties from "../catalog/parties.ts";
import * as products from "../catalog/products.ts";
import * as supplierProducts from "../catalog/supplier-products.ts";
import * as costs from "../costs/costs.ts";
import * as organizations from "../organizations/service.ts";
import * as followups from "../sales/followups.ts";
import * as sales from "../sales/sales.ts";
import * as settings from "../settings/service.ts";
import * as movements from "../stock/movements.ts";

// Cada serviço do sistema vira uma ferramenta da Netz. Um serviço novo entra
// sozinho; os de baixo ficam de fora porque lidam com senha, perfis de acesso
// ou arquivos.
const EXCLUDED = new Set([
  "members.add",
  "members.update",
  "members.password_link",
  "roles.create",
  "roles.update",
  "roles.delete",
  "products.images.add",
  "products.images.get",
  "organization.today",
]);

// Consultas rodam na hora; o resto vira proposta para a pessoa confirmar.
const READ = /\.(list|get|overview|dashboard|counts|movements)$/;

export const IMPROVEMENT_TOOL = "registrar_melhoria";
export const IMPROVEMENT_LIST_TOOL = "listar_melhorias";
export const IMPROVEMENT_COMPLEMENT_TOOL = "complementar_melhoria";
export const DELIVERIES_TOOL = "ver_mensagens_entregues";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyService = ServiceDefinition<z.ZodType, any>;

export interface NetsTool {
  name: string;
  service: AnyService;
  read: boolean;
  definition: Anthropic.Beta.BetaTool;
}

function isService(v: unknown): v is AnyService {
  const s = v as AnyService | null;
  return !!s && typeof s === "object" && typeof s.handler === "function" && typeof s.name === "string" && !!s.input;
}

// Esquema enxuto: sem $schema nem o padrão longo dos UUIDs (menos tokens).
function trim(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(trim);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema") continue;
    if (k === "pattern" && (node as { format?: string }).format === "uuid") continue;
    out[k] = trim(v);
  }
  return out;
}

const ALL: AnyService[] = [
  organizations, settings, audit, members, roles, parties, products, customFields, images, remove, supplierProducts,
  movements, sales, followups, costs,
]
  .flatMap((m) => Object.values(m))
  .filter(isService)
  .filter((s) => !EXCLUDED.has(s.name))
  .sort((a, b) => a.name.localeCompare(b.name));

function build(service: AnyService): NetsTool {
  const read = service.risk === 1 && READ.test(service.name);
  const schema = trim(z.toJSONSchema(service.input, { io: "input", unrepresentable: "any" })) as {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!read) {
    schema.properties = {
      _resumo: { type: "string", maxLength: 300, description: "Uma frase dizendo o que vai acontecer, para o cartão de confirmação." },
      ...schema.properties,
    };
    schema.required = ["_resumo", ...(schema.required ?? [])];
  }
  const name = service.name.replace(/\./g, "_");
  return {
    name,
    service,
    read,
    definition: {
      name,
      description: `${service.description}${read ? " (consulta: roda na hora)" : " (muda dados: vira proposta para a pessoa confirmar)"}`,
      input_schema: schema,
    },
  };
}

const TOOLS = ALL.map(build);

const improvementTool: Anthropic.Beta.BetaTool = {
  name: IMPROVEMENT_TOOL,
  description:
    "Registra um pedido de melhoria do sistema para a equipe do netzsales avaliar. Use quando a pessoa pedir algo que o sistema não faz ou quando você esbarrar numa limitação. Roda na hora, sem confirmação.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 3, maxLength: 200, description: "Título curto do pedido." },
      kind: { type: "string", enum: ["suggestion", "noticed"], description: "suggestion: a pessoa pediu. noticed: você percebeu." },
      module: {
        type: "string",
        enum: ["geral", "comercial", "catalogo", "estoque", "compras", "financeiro", "inteligencia", "assistente", "automacoes", "administracao", "comunicacao"],
        description: "comunicacao: pedidos sobre o seu jeito de conversar (vão para o seu manual, não para as telas).",
      },
      original: { type: "string", maxLength: 1500, description: "O que a pessoa disse, nas palavras dela." },
      problem: { type: "string", maxLength: 1500, description: "O problema ou a lacuna." },
      proposal: { type: "string", maxLength: 2000, description: "O que o sistema deveria fazer." },
      criteria: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 6, description: "Como saber que ficou pronto." },
    },
    required: ["title", "kind", "problem", "proposal"],
  },
};

const improvementListTool: Anthropic.Beta.BetaTool = {
  name: IMPROVEMENT_LIST_TOOL,
  description: "Lista os pedidos de melhoria abertos da empresa (número, título, situação). Consulta: roda na hora.",
  input_schema: { type: "object", properties: {} },
};

const improvementComplementTool: Anthropic.Beta.BetaTool = {
  name: IMPROVEMENT_COMPLEMENT_TOOL,
  description:
    "Complementa um pedido de melhoria já registrado, pelo número, em vez de abrir outro. O complemento fica na conversa do pedido com data e autor. " +
    "Se a pessoa quiser mudar o título, o problema, a proposta ou os critérios, mande o texto novo completo desses campos (só vale enquanto o pedido não entrou em desenvolvimento). Roda na hora, sem confirmação.",
  input_schema: {
    type: "object",
    properties: {
      number: { type: "integer", description: "Número do pedido (nº)." },
      complement: { type: "string", maxLength: 2000, description: "O que acrescentar, nas palavras da pessoa." },
      title: { type: "string", minLength: 3, maxLength: 200 },
      problem: { type: "string", maxLength: 1500 },
      proposal: { type: "string", maxLength: 2000 },
      criteria: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 6 },
    },
    required: ["number", "complement"],
  },
};

const deliveriesTool: Anthropic.Beta.BetaTool = {
  name: DELIVERIES_TOOL,
  description:
    "Mostra as suas últimas respostas a esta pessoa como elas chegaram: o texto do painel e o texto exato enviado em cada canal (Telegram), se foi entregue ou falhou, e as marcações internas que o sistema tirou antes de enviar. " +
    "Use quando a pessoa reclamar de algo numa mensagem (código estranho, texto cortado, não chegou), em vez de pedir print. Consulta: roda na hora.",
  input_schema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 30, description: "Quantas respostas, da mais nova para a mais antiga (padrão 10)." } },
  },
};

/** Ferramentas que esta pessoa pode usar, sempre na mesma ordem (cache). */
export function netsTools(actor: Actor): { tools: NetsTool[]; definitions: Anthropic.Beta.BetaTool[] } {
  const tools = TOOLS.filter((t) => !t.service.permission || can(actor, t.service.permission));
  return { tools, definitions: [...tools.map((t) => t.definition), improvementTool, improvementListTool, improvementComplementTool, deliveriesTool] };
}

/** Todas as ferramentas da Netz, para a tela da Plataforma (cada pessoa só recebe as permitidas). */
export function netsToolCatalog(): Array<{ name: string; description: string }> {
  return [...TOOLS.map((t) => t.definition), improvementTool, improvementListTool, improvementComplementTool, deliveriesTool].map((d) => ({
    name: d.name,
    description: d.description ?? "",
  }));
}
