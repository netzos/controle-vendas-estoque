import { can, type Actor, type FeatureKey } from "@erp/core";
import { CURRENT_PHASE, NAVIGATION, type NavGroup } from "./navigation";

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
  return NAVIGATION.map((g) => ({
    ...g,
    // No celular, o grupo Plataforma vai direto na barra de baixo do gestor.
    mobile: g.mobile || manager,
    items: g.items.filter(
      (i) =>
        i.phase <= CURRENT_PHASE &&
        (manager ? i.developerOnly : !i.developerOnly || developer) &&
        (!i.feature || features.has(i.feature)) &&
        (!i.permission || can(actor, i.permission)),
    ),
  })).filter((g) => g.items.length > 0);
}
