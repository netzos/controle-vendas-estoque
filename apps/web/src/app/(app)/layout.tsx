import { can, isPlatformDeveloper, listUserOrganizations } from "@erp/core";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { CURRENT_PHASE, NAVIGATION } from "@/lib/navigation";
import { OrganizationSwitcher, Shell } from "@/components/shell";
import { NetsBubble } from "@/components/nets-bubble";
import { Suspense } from "react";
import { logoutAction } from "../login/actions";
import { switchOrganizationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [organizations, developer] = await Promise.all([
    listUserOrganizations(db(), actor.userId),
    isPlatformDeveloper(db(), actor.userId),
  ]);
  // O menu mostra só o que o perfil pode abrir; as páginas verificam de novo.
  const navigation = NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.phase <= CURRENT_PHASE && (!i.developerOnly || developer) && (!i.permission || can(actor, i.permission))),
  })).filter((g) => g.items.length > 0);

  return (
    <Shell
      navigation={navigation}
      user={{ name: actor.userName }}
      logout={logoutAction}
      topbar={<OrganizationSwitcher organizations={organizations} activeId={actor.organizationId} action={switchOrganizationAction} />}
    >
      {children}
      {can(actor, "nets.use") && (
        <Suspense fallback={null}>
          <NetsBubble />
        </Suspense>
      )}
    </Shell>
  );
}
