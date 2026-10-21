import Link from "next/link";
import { can, listUserOrganizations } from "@erp/core";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { NAVIGATION } from "@/lib/navigation";
import { OrganizationSwitcher, Shell } from "@/components/shell";
import { logoutAction } from "../login/actions";
import { switchOrganizationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const organizations = await listUserOrganizations(db(), actor.userId);
  // O menu mostra só o que o perfil pode abrir; as páginas verificam de novo.
  const navigation = NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || can(actor, i.permission)),
  })).filter((g) => g.items.length > 0);

  return (
    <Shell
      navigation={navigation}
      topbar={
        <>
          <OrganizationSwitcher organizations={organizations} activeId={actor.organizationId} action={switchOrganizationAction} />
          <div className="topbar-right">
            <Link href="/conta/senha" className="muted">{actor.userName}</Link>
            <form action={logoutAction}>
              <button type="submit" className="secondary">Sair</button>
            </form>
          </div>
        </>
      }
    >
      {children}
    </Shell>
  );
}
