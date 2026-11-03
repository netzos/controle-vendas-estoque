import { can, enabledFeatures, isPlatformDeveloper, listPlatformOrganizations, listUserOrganizations, telegramConfigured, telegramOrganizationOf, whatsappConfigured, whatsappOrganizationOf } from "@erp/core";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { managerMode, visibleNavigation } from "@/lib/nav-visible";
import { OrganizationSwitcher, Shell } from "@/components/shell";
import { NetsBubble } from "@/components/nets-bubble";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "../login/actions";
import { switchOrganizationAction } from "./actions";
import { TelegramButton } from "./assistente/telegram/forms";
import { WhatsAppButton } from "./assistente/whatsapp/forms";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [own, developer, features] = await Promise.all([
    listUserOrganizations(db(), actor.userId),
    isPlatformDeveloper(db(), actor.userId),
    enabledFeatures(db(), actor.organizationId),
  ]);
  // O administrador escolhe no topo: "Plataforma" (a gestão, a casa dele) e depois as empresas clientes.
  // Ao escolher um cliente, vê o painel dele travado, só para consulta.
  const all = developer ? await listPlatformOrganizations(db(), actor.userId) : [];
  const home = developer ? (own.find((o) => all.find((a) => a.id === o.id)?.kind === "internal") ?? own[0]) : undefined;
  const organizations = developer
    ? [
        ...(home ? [{ id: home.id, name: "Plataforma (gestão)" }] : []),
        ...all
          .filter((o) => o.kind === "customer")
          .map((o) => ({ id: o.id, name: `${o.name}${o.status === "suspended" ? " (suspensa)" : ""}` })),
      ]
    : own;
  // Botão Telegram no topo de todas as telas: a pessoa chega à Netz com um clique.
  // No modo gestor não há Netz nem Telegram: a conta é só para gerir a plataforma.
  const manager = managerMode(actor, developer);
  const telegram = can(actor, "nets.use") && features.has("telegram") && telegramConfigured() && !actor.platformView && !manager;
  const telegramLinked = telegram && (await telegramOrganizationOf(db(), actor.userId)) !== null;
  // WhatsApp do netzsales (QR Code, Plataforma › WhatsApp): mesmo botão, ao lado do Telegram.
  const whatsapp = can(actor, "nets.use") && features.has("whatsapp") && whatsappConfigured() && !actor.platformView && !manager;
  const whatsappLinked = whatsapp && (await whatsappOrganizationOf(db(), actor.userId)) !== null;
  const viewing = actor.platformView ? all.find((o) => o.id === actor.organizationId) : undefined;
  const navigation = visibleNavigation(actor, developer, features);

  return (
    <Shell
      navigation={navigation}
      user={{ name: actor.userName }}
      logout={logoutAction}
      viewMode={actor.platformView}
      topbar={
        <div className="topbar-actions">
          {whatsapp && <WhatsAppButton linked={whatsappLinked} />}
          {telegram && <TelegramButton linked={telegramLinked} />}
          {/* Conta gestora: sem nome de empresa nem troca de empresa, só a Plataforma. */}
          {!manager && (
            <OrganizationSwitcher
              organizations={organizations}
              activeId={actor.organizationId}
              action={switchOrganizationAction}
              createHref={developer ? undefined : "/administracao/outra-empresa"}
            />
          )}
        </div>
      }
    >
      {actor.platformView && (
        <div className="alert view-banner" role="status">
          <span>
            Modo administrador: você está vendo o painel de <b>{viewing?.name ?? "uma empresa"}</b>, travado, só para consulta.{" "}
            <Link href={`/plataforma/empresas/${actor.organizationId}`}>Ver a ficha da empresa</Link>
          </span>
          {home && (
            <form action={switchOrganizationAction}>
              <input type="hidden" name="organizationId" value={home.id} />
              <button type="submit" className="view-back">Voltar para a Plataforma</button>
            </form>
          )}
        </div>
      )}
      {children}
      {can(actor, "nets.use") && features.has("netz") && !manager && (
        <Suspense fallback={null}>
          <NetsBubble />
        </Suspense>
      )}
    </Shell>
  );
}
