import { can, type Actor, type FeatureKey } from "@erp/core";
import { CURRENT_PHASE, NAVIGATION, type NavGroup } from "./navigation";

/** O menu mostra só o que o perfil pode abrir; as páginas verificam de novo. */
export function visibleNavigation(actor: Actor, developer: boolean, features: Set<FeatureKey>): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.phase <= CURRENT_PHASE && (!i.developerOnly || developer) && (!i.feature || features.has(i.feature)) && (!i.permission || can(actor, i.permission))),
  })).filter((g) => g.items.length > 0);
}
