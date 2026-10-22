// Catálogo de permissões. Fonte da verdade: este arquivo. O comando de
// migração sincroniza a tabela controle_vendas_estoque.permissions a partir dele.
//
// risk segue a seção 13: 1 consulta, 2 operação simples, 3 operação
// comercial, 4 operação crítica.

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
  risk: 1 | 2 | 3 | 4;
}

export const PERMISSIONS = [
  { key: "organization.view", module: "administracao", description: "Ver dados da empresa", risk: 1 },
  { key: "organization.update", module: "administracao", description: "Alterar dados da empresa", risk: 3 },
  { key: "branches.view", module: "administracao", description: "Ver filiais", risk: 1 },
  { key: "branches.manage", module: "administracao", description: "Criar e alterar filiais", risk: 3 },
  { key: "users.view", module: "administracao", description: "Ver usuários da empresa", risk: 1 },
  { key: "users.manage", module: "administracao", description: "Adicionar, alterar e desativar usuários", risk: 4 },
  { key: "roles.view", module: "administracao", description: "Ver perfis de acesso", risk: 1 },
  { key: "roles.manage", module: "administracao", description: "Criar e alterar perfis de acesso", risk: 4 },
  { key: "settings.view", module: "administracao", description: "Ver configurações gerais", risk: 1 },
  { key: "settings.update", module: "administracao", description: "Alterar configurações gerais", risk: 3 },
  { key: "audit.view", module: "administracao", description: "Consultar a auditoria", risk: 1 },
  { key: "customers.view", module: "comercial", description: "Ver clientes", risk: 1 },
  { key: "customers.manage", module: "comercial", description: "Cadastrar e alterar clientes", risk: 2 },
  { key: "suppliers.view", module: "compras", description: "Ver fornecedores", risk: 1 },
  { key: "suppliers.manage", module: "compras", description: "Cadastrar e alterar fornecedores", risk: 2 },
  { key: "products.view", module: "catalogo", description: "Ver produtos, categorias e unidades", risk: 1 },
  { key: "products.manage", module: "catalogo", description: "Cadastrar e alterar produtos, categorias e unidades", risk: 2 },
  { key: "products.update_price", module: "catalogo", description: "Alterar preço de venda e custo", risk: 3 },
  { key: "custom_fields.manage", module: "catalogo", description: "Criar e alterar campos personalizados dos itens", risk: 3 },
  { key: "sales.view", module: "comercial", description: "Ver vendas e o painel de vendas", risk: 1 },
  { key: "sales.create", module: "comercial", description: "Registrar vendas", risk: 3 },
  { key: "sales.cancel", module: "comercial", description: "Cancelar vendas", risk: 4 },
  { key: "sales.change_price", module: "comercial", description: "Mudar o preço de um item na hora da venda", risk: 3 },
  { key: "sales.trade_in", module: "comercial", description: "Aceitar item na troca como parte do pagamento", risk: 3 },
  { key: "stock.view", module: "estoque", description: "Ver estoque, movimentações e o painel do estoque", risk: 1 },
  { key: "stock.manage", module: "estoque", description: "Lançar entradas, saídas e ajustes de estoque", risk: 3 },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermission(key: string): key is Permission {
  return PERMISSION_KEYS.has(key);
}

export const MODULE_LABELS: Record<string, string> = {
  comercial: "Comercial",
  catalogo: "Catálogo",
  estoque: "Estoque",
  compras: "Compras",
  administracao: "Administração",
};

// Perfis criados em toda organização nova. O proprietário (is_owner) tem
// todas as permissões, inclusive as que forem adicionadas no futuro.
export interface SystemRole {
  key: string;
  name: string;
  description: string;
  permissions: readonly Permission[] | "all";
}

const VIEW_ONLY = PERMISSIONS.filter((p) => p.risk === 1).map((p) => p.key);

export const SYSTEM_ROLES: readonly SystemRole[] = [
  { key: "owner", name: "Proprietário", description: "Acesso total à empresa", permissions: "all" },
  { key: "admin", name: "Administrador", description: "Administra a empresa, usuários e configurações", permissions: "all" },
  { key: "sales", name: "Vendedor", description: "Opera vendas e clientes", permissions: ["organization.view", "branches.view", "customers.view", "customers.manage", "products.view", "sales.view", "sales.create", "stock.view"] },
  { key: "finance", name: "Financeiro", description: "Opera contas a pagar e a receber", permissions: ["organization.view", "branches.view", "customers.view", "suppliers.view", "products.view", "sales.view", "stock.view"] },
  { key: "stock", name: "Estoquista", description: "Opera estoque e recebimentos", permissions: ["organization.view", "branches.view", "suppliers.view", "suppliers.manage", "products.view", "products.manage", "stock.view", "stock.manage"] },
  { key: "viewer", name: "Consulta", description: "Apenas consulta", permissions: VIEW_ONLY },
];
