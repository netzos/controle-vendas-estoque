// Catálogo de permissões. Fonte da verdade: este arquivo. O comando de
// migração sincroniza a tabela erp.permissions a partir dele.
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
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermission(key: string): key is Permission {
  return PERMISSION_KEYS.has(key);
}

export const MODULE_LABELS: Record<string, string> = {
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
  { key: "sales", name: "Vendedor", description: "Opera vendas e clientes", permissions: ["organization.view", "branches.view"] },
  { key: "finance", name: "Financeiro", description: "Opera contas a pagar e a receber", permissions: ["organization.view", "branches.view"] },
  { key: "stock", name: "Estoquista", description: "Opera estoque e recebimentos", permissions: ["organization.view", "branches.view"] },
  { key: "viewer", name: "Consulta", description: "Apenas consulta", permissions: VIEW_ONLY },
];
