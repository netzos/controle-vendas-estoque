import { can, type Actor, type FeatureKey } from "@erp/core";
import { CURRENT_PHASE, NAVIGATION, type NavGroup, type NavIcon } from "./navigation";

/** Na conta gestora, cada tela da Plataforma vira um item do menu principal. */
const MANAGER_MENU: Record<string, { short: string; icon: NavIcon; hint: string; mobile?: boolean }> = {
  "/plataforma": { short: "Painel", icon: "chart", hint: "Como está o netzsales: clientes, uso, receita e custos", mobile: true },
  "/plataforma/empresas": { short: "Empresas", icon: "box", hint: "Quem usa o netzsales", mobile: true },
  "/plataforma/pedidos": { short: "Pedidos", icon: "plus", hint: "Empresas pedindo para entrar" },
  "/plataforma/usuarios": { short: "Usuários", icon: "users", hint: "Todas as pessoas que usam o netzsales" },
  "/plataforma/financeiro": { short: "Receita", icon: "coins", hint: "Quanto entra e quanto custa" },
  "/plataforma/melhorias": { short: "Melhorias", icon: "bulb", hint: "Pedidos de melhoria de todos os clientes", mobile: true },
  "/plataforma/comunicacao": { short: "Netz", icon: "bot", hint: "Como a Netz conversa com os clientes" },
  "/plataforma/liberacoes": { short: "Liberações", icon: "sliders", hint: "O que cada empresa pode usar" },
};

/**
 * Modo gestor: o administrador da plataforma, na própria conta, vê só as telas
 * da Plataforma (como no NetzOS e no IONPA). Ao consultar uma empresa pelo topo,
 * vê as telas dela, só para consulta, e a Plataforma para voltar.
 */
export function managerMode(actor: Actor, developer: boolean): boolean {
  return developer && !actor.platformView;
}

/** O menu mostra só o que o perfil pode abrir; as páginas verificam de novo. */
export function visibleNavigation(actor: Actor, developer: boolean, features: Set<FeatureKey>): NavGroup[] {
  const manager = managerMode(actor, developer);
  if (manager) {
    return NAVIGATION.flatMap((g) => g.items)
      .filter((i) => i.developerOnly && i.phase <= CURRENT_PHASE && MANAGER_MENU[i.href])
      .map((i) => ({ label: i.label, area: "Plataforma" as const, ...MANAGER_MENU[i.href]!, items: [i] }));
  }
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        i.phase <= CURRENT_PHASE &&
        (!i.developerOnly || developer) &&
        (!i.feature || features.has(i.feature)) &&
        (!i.permission || can(actor, i.permission)),
    ),
  })).filter((g) => g.items.length > 0);
}
