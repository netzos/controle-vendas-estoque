import type { Permission } from "@erp/core";

// Estrutura de telas da seção 25. Itens de fases futuras ficam fora do menu
// até serem entregues; não há tela vazia fingindo funcionalidade.
export interface NavItem {
  label: string;
  href: string;
  permission?: Permission;
  phase: number;
}

export type NavIcon = "home" | "cart" | "tag" | "box" | "truck" | "wallet" | "coins" | "chart" | "bot" | "zap" | "bulb" | "sliders";

export interface NavGroup {
  label: string;
  /** Nome curto no menu lateral. */
  short: string;
  /** Frase do topo da página, como no layout de referência. */
  hint: string;
  icon: NavIcon;
  items: NavItem[];
}

export const CURRENT_PHASE = 2;

export const NAVIGATION: NavGroup[] = [
  {
    label: "Visão geral",
    short: "Início",
    hint: "Como estão as vendas",
    icon: "home",
    items: [
      { label: "Início", href: "/", phase: 1 },
      { label: "Central de alertas", href: "/alertas", phase: 6 },
    ],
  },
  {
    label: "Comercial",
    short: "Vendas",
    hint: "Clientes, vendas e orçamentos",
    icon: "cart",
    items: [
      { label: "Vendas", href: "/vendas", permission: "sales.view", phase: 2 },
      { label: "Entregas", href: "/entregas", permission: "deliveries.view", phase: 2 },
      { label: "Etapas depois da venda", href: "/etapas", permission: "deliveries.view", phase: 2 },
      { label: "Orçamentos", href: "/orcamentos", phase: 3 },
      { label: "Clientes", href: "/clientes", permission: "customers.view", phase: 2 },
      { label: "Vendedores", href: "/vendedores", phase: 3 },
      { label: "Serviços", href: "/servicos", phase: 3 },
    ],
  },
  {
    label: "Catálogo",
    short: "Catálogo",
    hint: "Produtos, categorias e unidades que você vende",
    icon: "tag",
    items: [
      { label: "Produtos", href: "/produtos", permission: "products.view", phase: 2 },
      { label: "Categorias", href: "/categorias", permission: "products.view", phase: 2 },
      { label: "Marcas", href: "/marcas", phase: 3 },
      { label: "Unidades de medida", href: "/unidades", permission: "products.view", phase: 2 },
      { label: "Tabelas de preços", href: "/tabelas-de-precos", phase: 3 },
      { label: "Campos personalizados", href: "/campos-personalizados", permission: "products.view", phase: 2 },
    ],
  },
  {
    label: "Estoque",
    short: "Estoque",
    hint: "Saldo, giro e cobertura de cada produto",
    icon: "box",
    items: [
      { label: "Painel do estoque", href: "/estoque", permission: "stock.view", phase: 2 },
      { label: "Movimentações", href: "/estoque/movimentacoes", permission: "stock.view", phase: 2 },
      { label: "Depósitos", href: "/estoque/depositos", phase: 4 },
      { label: "Inventários", href: "/estoque/inventarios", phase: 4 },
      { label: "Transferências", href: "/estoque/transferencias", phase: 4 },
      { label: "Lotes e validades", href: "/estoque/lotes", phase: 4 },
      { label: "Reposição", href: "/estoque/reposicao", phase: 4 },
    ],
  },
  {
    label: "Compras",
    short: "Compras",
    hint: "Fornecedores e pedidos de compra",
    icon: "truck",
    items: [
      { label: "Fornecedores", href: "/fornecedores", permission: "suppliers.view", phase: 2 },
      { label: "Pedidos de compra", href: "/compras/pedidos", phase: 4 },
      { label: "Recebimentos", href: "/compras/recebimentos", phase: 4 },
      { label: "Sugestões de compra", href: "/compras/sugestoes", phase: 4 },
    ],
  },
  {
    label: "Custos",
    short: "Custos",
    hint: "Quanto custa vender e o lucro de verdade",
    icon: "coins",
    items: [
      { label: "Painel de custos", href: "/custos", permission: "costs.view", phase: 2 },
      { label: "Custo de obtenção", href: "/custos/obtencao", permission: "costs.view", phase: 2 },
      { label: "Tipos de custo", href: "/custos/tipos", permission: "costs.view", phase: 2 },
    ],
  },
  {
    label: "Financeiro",
    short: "Financeiro",
    hint: "Contas a pagar e a receber",
    icon: "wallet",
    items: [
      { label: "Contas a receber", href: "/financeiro/receber", phase: 5 },
      { label: "Contas a pagar", href: "/financeiro/pagar", phase: 5 },
      { label: "Despesas", href: "/financeiro/despesas", phase: 5 },
      { label: "Fluxo de caixa", href: "/financeiro/fluxo", phase: 5 },
    ],
  },
  {
    label: "Inteligência",
    short: "Relatórios",
    hint: "Números do negócio",
    icon: "chart",
    items: [
      { label: "Dashboard comercial", href: "/inteligencia", phase: 7 },
      { label: "Relatórios", href: "/relatorios", phase: 7 },
    ],
  },
  {
    label: "Assistente IA",
    short: "Assistente",
    hint: "Nets no painel e no Telegram",
    icon: "bot",
    items: [
      { label: "Telegram", href: "/assistente/telegram", permission: "nets.use", phase: 2 },
      { label: "Operações", href: "/assistente/operacoes", phase: 8 },
      { label: "Configurações do assistente", href: "/assistente/configuracoes", phase: 8 },
    ],
  },
  {
    label: "Automações",
    short: "Automações",
    hint: "Regras automáticas",
    icon: "zap",
    items: [
      { label: "Regras", href: "/automacoes", phase: 6 },
      { label: "Relatórios programados", href: "/automacoes/relatorios", phase: 6 },
      { label: "Histórico de execuções", href: "/automacoes/historico", phase: 6 },
    ],
  },
  {
    label: "Colaboração",
    short: "Melhorias",
    hint: "Peça mudanças no sistema; o desenvolvedor aprova",
    icon: "bulb",
    items: [{ label: "Melhorias", href: "/melhorias", phase: 1 }],
  },
  {
    label: "Administração",
    short: "Ajustes",
    hint: "Empresa, usuários e permissões",
    icon: "sliders",
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
