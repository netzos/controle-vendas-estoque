import type { Permission } from "@erp/core";

// Estrutura de telas da seção 25. Itens de fases futuras aparecem
// desabilitados, com a fase em que serão entregues; não há tela vazia
// fingindo funcionalidade.
export interface NavItem {
  label: string;
  href: string;
  permission?: Permission;
  phase: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const CURRENT_PHASE = 1;

export const NAVIGATION: NavGroup[] = [
  {
    label: "Visão geral",
    items: [
      { label: "Início", href: "/", phase: 1 },
      { label: "Central de alertas", href: "/alertas", phase: 6 },
    ],
  },
  {
    label: "Comercial",
    items: [
      { label: "Vendas", href: "/vendas", phase: 3 },
      { label: "Orçamentos", href: "/orcamentos", phase: 3 },
      { label: "Clientes", href: "/clientes", phase: 2 },
      { label: "Vendedores", href: "/vendedores", phase: 3 },
      { label: "Serviços", href: "/servicos", phase: 2 },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Produtos", href: "/produtos", phase: 2 },
      { label: "Categorias", href: "/categorias", phase: 2 },
      { label: "Marcas", href: "/marcas", phase: 2 },
      { label: "Unidades de medida", href: "/unidades", phase: 2 },
      { label: "Tabelas de preços", href: "/tabelas-de-precos", phase: 2 },
      { label: "Campos personalizados", href: "/campos-personalizados", phase: 2 },
    ],
  },
  {
    label: "Estoque",
    items: [
      { label: "Saldos", href: "/estoque/saldos", phase: 4 },
      { label: "Movimentações", href: "/estoque/movimentacoes", phase: 4 },
      { label: "Depósitos", href: "/estoque/depositos", phase: 4 },
      { label: "Inventários", href: "/estoque/inventarios", phase: 4 },
      { label: "Transferências", href: "/estoque/transferencias", phase: 4 },
      { label: "Lotes e validades", href: "/estoque/lotes", phase: 4 },
      { label: "Reposição", href: "/estoque/reposicao", phase: 4 },
    ],
  },
  {
    label: "Compras",
    items: [
      { label: "Fornecedores", href: "/fornecedores", phase: 2 },
      { label: "Pedidos de compra", href: "/compras/pedidos", phase: 4 },
      { label: "Recebimentos", href: "/compras/recebimentos", phase: 4 },
      { label: "Sugestões de compra", href: "/compras/sugestoes", phase: 4 },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { label: "Contas a receber", href: "/financeiro/receber", phase: 5 },
      { label: "Contas a pagar", href: "/financeiro/pagar", phase: 5 },
      { label: "Despesas", href: "/financeiro/despesas", phase: 5 },
      { label: "Fluxo de caixa", href: "/financeiro/fluxo", phase: 5 },
    ],
  },
  {
    label: "Inteligência",
    items: [
      { label: "Dashboard comercial", href: "/inteligencia", phase: 7 },
      { label: "Relatórios", href: "/relatorios", phase: 7 },
    ],
  },
  {
    label: "Assistente IA",
    items: [
      { label: "Integração Telegram", href: "/assistente/telegram", phase: 8 },
      { label: "Operações", href: "/assistente/operacoes", phase: 8 },
      { label: "Configurações do assistente", href: "/assistente/configuracoes", phase: 8 },
    ],
  },
  {
    label: "Automações",
    items: [
      { label: "Regras", href: "/automacoes", phase: 6 },
      { label: "Relatórios programados", href: "/automacoes/relatorios", phase: 6 },
      { label: "Histórico de execuções", href: "/automacoes/historico", phase: 6 },
    ],
  },
  {
    label: "Colaboração",
    items: [{ label: "Melhorias", href: "/melhorias", phase: 1 }],
  },
  {
    label: "Administração",
    items: [
      { label: "Empresa", href: "/administracao/empresa", permission: "organization.view", phase: 1 },
      { label: "Filiais", href: "/administracao/filiais", permission: "branches.view", phase: 1 },
      { label: "Usuários", href: "/administracao/usuarios", permission: "users.view", phase: 1 },
      { label: "Permissões", href: "/administracao/permissoes", permission: "roles.view", phase: 1 },
      { label: "Auditoria", href: "/administracao/auditoria", permission: "audit.view", phase: 1 },
      { label: "Configurações gerais", href: "/administracao/configuracoes", permission: "settings.view", phase: 1 },
    ],
  },
];
