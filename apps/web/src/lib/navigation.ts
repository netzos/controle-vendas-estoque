import type { FeatureKey, Permission } from "@erp/core";

// Menu organizado pelas tarefas do dia de quem vende (reanálise de 24/10/2026):
// vender, ver as vendas, cuidar dos produtos, dos clientes e do dinheiro.
// O que se configura uma vez fica em Ajustes, numa página de atalhos por assunto.
// Itens de fases futuras ficam fora do menu até serem entregues.
export interface NavItem {
  label: string;
  href: string;
  permission?: Permission;
  /** Só o administrador da plataforma vê. */
  developerOnly?: boolean;
  /** Parte do sistema que precisa estar liberada para a empresa (Plataforma › Liberações). */
  feature?: FeatureKey;
  phase: number;
  /** Assunto na página de Ajustes. */
  section?: string;
  /** Frase curta embaixo do nome, na página de Ajustes. */
  description?: string;
}

export type NavIcon = "home" | "plus" | "cart" | "tag" | "users" | "box" | "truck" | "wallet" | "coins" | "chart" | "bot" | "zap" | "bulb" | "sliders" | "shield";

export interface NavGroup {
  label: string;
  /** Nome curto no menu lateral. */
  short: string;
  /** Frase do topo da página, como no layout de referência. */
  hint: string;
  icon: NavIcon;
  /** Botão de destaque no menu (Vender). */
  primary?: boolean;
  /** Página de atalhos do grupo: o menu leva para ela e as telas mostram "← Ajustes" em vez de abas. */
  hub?: string;
  /** Aparece direto na barra de baixo do celular; os outros ficam em "Mais". */
  mobile?: boolean;
  items: NavItem[];
}

export const CURRENT_PHASE = 2;

export const NAVIGATION: NavGroup[] = [
  {
    label: "Início",
    short: "Início",
    hint: "Como estão as vendas",
    icon: "home",
    mobile: true,
    items: [
      { label: "Início", href: "/", phase: 1 },
      { label: "Central de alertas", href: "/alertas", phase: 6 },
      { label: "Relatórios", href: "/relatorios", phase: 7 },
    ],
  },
  {
    label: "Vender",
    short: "Vender",
    hint: "Registre uma venda em poucos toques",
    icon: "plus",
    primary: true,
    mobile: true,
    items: [{ label: "Nova venda", href: "/vendas/nova", permission: "sales.create", phase: 2 }],
  },
  {
    label: "Vendas",
    short: "Vendas",
    hint: "Vendas feitas e o que falta entregar",
    icon: "cart",
    mobile: true,
    items: [
      { label: "Vendas", href: "/vendas", permission: "sales.view", phase: 2 },
      { label: "Entregas e serviços", href: "/entregas", permission: "deliveries.view", feature: "deliveries", phase: 2 },
      { label: "Orçamentos", href: "/orcamentos", phase: 3 },
    ],
  },
  {
    label: "Produtos",
    short: "Produtos",
    hint: "O que você vende, o estoque e quem fornece",
    icon: "tag",
    mobile: true,
    items: [
      { label: "Produtos", href: "/produtos", permission: "products.view", phase: 2 },
      { label: "Estoque", href: "/estoque", permission: "stock.view", phase: 2 },
      { label: "Entradas e saídas", href: "/estoque/movimentacoes", permission: "stock.view", phase: 2 },
      { label: "Fornecedores", href: "/fornecedores", permission: "suppliers.view", phase: 2 },
      { label: "Pedidos de compra", href: "/compras/pedidos", phase: 4 },
    ],
  },
  {
    label: "Clientes",
    short: "Clientes",
    hint: "Quem compra de você",
    icon: "users",
    items: [{ label: "Clientes", href: "/clientes", permission: "customers.view", phase: 2 }],
  },
  {
    label: "Financeiro",
    short: "Financeiro",
    hint: "Gastos, custo de cada produto, comissões e quanto sobra de verdade",
    icon: "wallet",
    items: [
      { label: "Lucro real", href: "/custos", permission: "costs.view", feature: "costs", phase: 2 },
      { label: "Custo de cada produto", href: "/custos/obtencao", permission: "costs.view", feature: "costs", phase: 2 },
      { label: "Comissões", href: "/comissoes", permission: "commissions.view", feature: "commissions", phase: 2 },
      { label: "A receber", href: "/financeiro/receber", phase: 5 },
      { label: "A pagar", href: "/financeiro/pagar", phase: 5 },
    ],
  },
  {
    label: "Ajustes",
    short: "Ajustes",
    hint: "Sua empresa, a equipe e como o netzsales funciona para você",
    icon: "sliders",
    hub: "/ajustes",
    items: [
      { label: "Dados da empresa", href: "/administracao/empresa", permission: "organization.view", phase: 1, section: "Empresa", description: "Nome, documento e contato" },
      { label: "Filiais", href: "/administracao/filiais", permission: "branches.view", phase: 1, section: "Empresa", description: "Lojas ou pontos de venda" },
      { label: "Configurações gerais", href: "/administracao/configuracoes", permission: "settings.view", phase: 1, section: "Empresa", description: "Nome nos documentos, semana e casas decimais" },
      { label: "Nova empresa", href: "/administracao/outra-empresa", phase: 1, section: "Empresa", description: "Tem outro negócio? Crie na mesma conta" },
      { label: "Equipe", href: "/administracao/usuarios", permission: "users.view", phase: 1, section: "Equipe", description: "Quem usa o netzsales e o link de acesso de cada um" },
      { label: "O que cada um pode fazer", href: "/administracao/permissoes", permission: "roles.view", phase: 1, section: "Equipe", description: "Perfis de acesso: vendedor, estoquista e outros" },
      { label: "Histórico de alterações", href: "/administracao/auditoria", permission: "audit.view", phase: 1, section: "Equipe", description: "Quem mudou o quê e quando" },
      { label: "Categorias", href: "/categorias", permission: "products.view", phase: 2, section: "Listas usadas nos cadastros", description: "Grupos de produtos" },
      { label: "Unidades de medida", href: "/unidades", permission: "products.view", phase: 2, section: "Listas usadas nos cadastros", description: "Unidade, kg, lata, litro…" },
      { label: "Campos personalizados", href: "/campos-personalizados", permission: "products.view", feature: "custom_fields", phase: 2, section: "Listas usadas nos cadastros", description: "Informações extras nos produtos" },
      { label: "Etapas depois da venda", href: "/etapas", permission: "deliveries.view", feature: "deliveries", phase: 2, section: "Listas usadas nos cadastros", description: "Entrega, instalação, montagem: prazos e custos padrão" },
      { label: "Grupos de custo", href: "/custos/tipos", permission: "costs.view", feature: "costs", phase: 2, section: "Listas usadas nos cadastros", description: "Aluguel, frete, energia…" },
      // O dia a dia do Telegram é o botão do topo; aqui ficam a ligação e o Desligar.
      { label: "Meu Telegram", href: "/assistente/telegram", permission: "nets.use", feature: "telegram", phase: 2, section: "Netz e melhorias", description: "Ligar ou desligar a Netz no seu Telegram" },
      { label: "Pedir uma melhoria", href: "/melhorias", phase: 1, section: "Netz e melhorias", description: "Falta algo? Peça aqui e a equipe netzsales responde" },
    ],
  },
  {
    label: "Plataforma",
    short: "Plataforma",
    hint: "Clientes, crescimento, receita e custos de todo o netzsales",
    icon: "shield",
    items: [
      { label: "Painel", href: "/plataforma", developerOnly: true, phase: 1 },
      { label: "Empresas", href: "/plataforma/empresas", developerOnly: true, phase: 1 },
      { label: "Pedidos de cadastro", href: "/plataforma/pedidos", developerOnly: true, phase: 1 },
      { label: "Usuários", href: "/plataforma/usuarios", developerOnly: true, phase: 1 },
      { label: "Receita e custos", href: "/plataforma/financeiro", developerOnly: true, phase: 1 },
      { label: "Melhorias", href: "/plataforma/melhorias", developerOnly: true, phase: 1 },
      { label: "Comunicação da Netz", href: "/plataforma/comunicacao", developerOnly: true, phase: 1 },
      { label: "Liberações", href: "/plataforma/liberacoes", developerOnly: true, phase: 1 },
    ],
  },
];
