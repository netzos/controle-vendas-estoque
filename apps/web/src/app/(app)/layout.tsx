import { can, enabledFeatures, isPlatformDeveloper, listUserOrganizations } from "@erp/core";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { CURRENT_PHASE, NAVIGATION } from "@/lib/navigation";
import { OrganizationSwitcher, Shell } from "@/components/shell";
import { NetsBubble } from "@/components/nets-bubble";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "../login/actions";
import { switchOrganizationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [organizations, developer, features] = await Promise.all([
    listUserOrganizations(db(), actor.userId),
    isPlatformDeveloper(db(), actor.userId),
    enabledFeatures(db(), actor.organizationId),
  ]);
  // O menu mostra só o que o perfil pode abrir; as páginas verificam de novo.
  const navigation = NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.phase <= CURRENT_PHASE && (!i.developerOnly || developer) && (!i.feature || features.has(i.feature)) && (!i.permission || can(actor, i.permission))),
  })).filter((g) => g.items.length > 0);

  return (
    <Shell
      navigation={navigation}
      user={{ name: actor.userName }}
      logout={logoutAction}
      topbar={
        <div className="topbar-actions">
          {developer && <Link href="/plataforma" className="button secondary small">Painel da plataforma</Link>}
          <OrganizationSwitcher organizations={organizations} activeId={actor.organizationId} action={switchOrganizationAction} />
        </div>
      }
    >
      {children}
      {can(actor, "nets.use") && features.has("netz") && (
        <Suspense fallback={null}>
          <NetsBubble />
        </Suspense>
      )}
    </Shell>
  );
}
