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
import * as commissions from "../commissions/commissions.ts";
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
  "customers.photo.set",
  "customers.photo.get",
  "organization.today",
]);

// Consultas rodam na hora; o resto vira proposta para a pessoa confirmar.
const READ = /\.(list|get|overview|dashboard|counts|movements|panel)$/;

export const IMPROVEMENT_TOOL = "registrar_melhoria";
export const IMPROVEMENT_LIST_TOOL = "listar_melhorias";
export const IMPROVEMENT_COMPLEMENT_TOOL = "complementar_melhoria";
export const DELIVERIES_TOOL = "ver_mensagens_entregues";
export const PERSON_NOTE_TOOL = "anotar_jeito";
export const BATCH_TOOL = "propor_lote";
export const BATCH_LIMIT = 200;

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
  movements, sales, followups, costs, commissions,
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

const personNoteTool: Anthropic.Beta.BetaTool = {
  name: PERSON_NOTE_TOOL,
  description:
    "Anota algo sobre o jeito desta pessoa gostar de ser atendida (organização, ritmo, quanto detalhe quer, se gosta de ser lembrada ou cobrada, tom). " +
    "A anotação aparece para você em todas as próximas conversas com ela. Use substitui com o número da nota quando uma anotação antiga mudou. Roda na hora, sem confirmação.",
  input_schema: {
    type: "object",
    properties: {
      observacao: { type: "string", minLength: 3, maxLength: 500, description: "Uma frase sobre o jeito da pessoa e o que fazer com isso. Ex.: \"Prefere respostas bem curtas; não oferecer cadastros extras.\"" },
      substitui: { type: "integer", description: "Número (#) da nota que esta atualiza, se for o caso." },
    },
    required: ["observacao"],
  },
};

// Lista colada pela pessoa (clientes, produtos...) vira um cartão só, em vez
// de um cartão e uma resposta da IA por item.
function batchTool(writable: string[]): Anthropic.Beta.BetaTool {
  return {
    name: BATCH_TOOL,
    description:
      `Propõe a mesma ação para vários itens de uma vez (ex.: cadastrar uma lista de clientes, produtos ou fornecedores que a pessoa colou). Um único cartão confirma tudo. ` +
      `Use sempre que houver 2 ou mais itens, em vez de propor um por um. Até ${BATCH_LIMIT} itens. (muda dados: vira proposta para a pessoa confirmar)`,
    input_schema: {
      type: "object",
      properties: {
        _resumo: { type: "string", maxLength: 300, description: "Uma frase dizendo o que vai acontecer. Ex.: \"Cadastrar 25 clientes da lista\"." },
        ferramenta: { type: "string", enum: writable, description: "A ferramenta que roda em cada item." },
        itens: {
          type: "array",
          minItems: 1,
          maxItems: BATCH_LIMIT,
          items: { type: "object" },
          description: "Os dados de cada item, com os mesmos campos da ferramenta (sem _resumo). Leve todos os dados que a pessoa mandou de cada um.",
        },
      },
      required: ["_resumo", "ferramenta", "itens"],
    },
  };
}

/** Ferramentas que esta pessoa pode usar, sempre na mesma ordem (cache). */
export function netsTools(actor: Actor): { tools: NetsTool[]; definitions: Anthropic.Beta.BetaTool[] } {
  const tools = TOOLS.filter((t) => !t.service.permission || can(actor, t.service.permission));
  const writable = tools.filter((t) => !t.read).map((t) => t.name);
  return {
    tools,
    definitions: [
      ...tools.map((t) => t.definition),
      ...(writable.length ? [batchTool(writable)] : []),
      improvementTool, improvementListTool, improvementComplementTool, deliveriesTool, personNoteTool,
    ],
  };
}

/** Todas as ferramentas da Netz, para a tela da Plataforma (cada pessoa só recebe as permitidas). */
export function netsToolCatalog(): Array<{ name: string; description: string }> {
  return [...TOOLS.map((t) => t.definition), batchTool(TOOLS.filter((t) => !t.read).map((t) => t.name)), improvementTool, improvementListTool, improvementComplementTool, deliveriesTool, personNoteTool].map((d) => ({
    name: d.name,
    description: d.description ?? "",
  }));
}
