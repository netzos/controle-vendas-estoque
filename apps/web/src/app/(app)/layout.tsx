import { can, enabledFeatures, isPlatformDeveloper, listPlatformOrganizations, listUserOrganizations, telegramConfigured, telegramOrganizationOf } from "@erp/core";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { visibleNavigation } from "@/lib/nav-visible";
import { OrganizationSwitcher, Shell } from "@/components/shell";
import { NetsBubble } from "@/components/nets-bubble";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "../login/actions";
import { switchOrganizationAction } from "./actions";
import { TelegramButton } from "./assistente/telegram/forms";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [own, developer, features] = await Promise.all([
    listUserOrganizations(db(), actor.userId),
    isPlatformDeveloper(db(), actor.userId),
    enabledFeatures(db(), actor.organizationId),
  ]);
  // O administrador escolhe qualquer empresa no topo: clientes primeiro, depois as internas.
  const all = developer ? await listPlatformOrganizations(db(), actor.userId) : [];
  const organizations = developer
    ? [...all.filter((o) => o.kind === "customer"), ...all.filter((o) => o.kind === "internal")].map((o) => ({
        id: o.id,
        name: `${o.name}${o.kind === "internal" ? " (equipe)" : ""}${o.status === "suspended" ? " (suspensa)" : ""}`,
      }))
    : own;
  // Botão Telegram no topo de todas as telas: a pessoa chega à Netz com um clique.
  const telegram = can(actor, "nets.use") && features.has("telegram") && telegramConfigured() && !actor.platformView;
  const telegramLinked = telegram && (await telegramOrganizationOf(db(), actor.userId)) !== null;
  const viewing = actor.platformView ? all.find((o) => o.id === actor.organizationId) : undefined;
  const navigation = visibleNavigation(actor, developer, features);

  return (
    <Shell
      navigation={navigation}
      user={{ name: actor.userName }}
      logout={logoutAction}
      topbar={
        <div className="topbar-actions">
          {telegram && <TelegramButton linked={telegramLinked} />}
          {developer && <Link href="/plataforma" className="button secondary small">Painel da plataforma</Link>}
          <OrganizationSwitcher
            organizations={organizations}
            activeId={actor.organizationId}
            action={switchOrganizationAction}
            createHref={developer ? undefined : "/administracao/outra-empresa"}
          />
        </div>
      }
    >
      {actor.platformView && (
        <div className="alert view-banner" role="status">
          Você está vendo os dados de <b>{viewing?.name ?? "uma empresa"}</b> como administrador da plataforma, só para consulta.{" "}
          <Link href={`/plataforma/empresas/${actor.organizationId}`}>Precisa mexer? Entre para dar suporte pela ficha da empresa.</Link>
        </div>
      )}
      {children}
      {can(actor, "nets.use") && features.has("netz") && (
        <Suspense fallback={null}>
          <NetsBubble />
        </Suspense>
      )}
    </Shell>
  );
}
