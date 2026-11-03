import { getOrganization, getWhatsAppStatus, listUserOrganizations } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { ConnectWhatsApp, DisconnectWhatsApp, WhatsAppButton, WhatsAppOrganizations } from "./forms";

export const metadata = { title: "WhatsApp" };

export default async function WhatsAppPage() {
  const actor = await requirePermission("nets.use");
  const [status, org, organizations] = await Promise.all([getWhatsAppStatus(db(), actor), query(getOrganization, {}), listUserOrganizations(db(), actor.userId)]);
  const link = status.link;
  const here = link?.organizationId === actor.organizationId;
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <div className="page-header">
        <h1>WhatsApp</h1>
        <p>Converse com a Netz pelo WhatsApp do netzsales, com os mesmos dados e permissões do painel. Antes de mudar algo, ela pede para você responder SIM ou NÃO.</p>
      </div>
      <section className="card">
        {!status.configured ? (
          <p className="muted">O WhatsApp do netzsales ainda não foi ligado nesta instalação. Quem administra o netzsales conecta o número em Plataforma › WhatsApp.</p>
        ) : link ? (
          <>
            <h2>Ligado</h2>
            <p>
              WhatsApp +{link.phone} ligado em {fmt.format(link.createdAt)}
              {here || organizations.length < 2 ? ` à empresa ${organizations.find((o) => o.id === link.organizationId)?.name ?? org.name}.` : "."}
            </p>
            <div className="actions">
              {here && <WhatsAppButton linked large />}
              <ConnectWhatsApp again />
              <DisconnectWhatsApp />
            </div>
          </>
        ) : (
          <>
            <h2>Ligar</h2>
            <ol className="steps-howto">
              <li>Toque no botão abaixo. O WhatsApp abre na conversa com a Netz, com uma mensagem já escrita.</li>
              <li>Envie essa mensagem do jeito que está. Pronto: seu WhatsApp fica ligado a {org.name}.</li>
              <li>Escreva ou mande áudio, como &quot;vendi 2 latas no pix&quot; ou &quot;quanto tenho em estoque?&quot;.</li>
            </ol>
            <ConnectWhatsApp again={false} />
            <p className="muted small-text">O botão do WhatsApp no alto da tela faz a mesma coisa, de qualquer página. O código vale 15 minutos.</p>
          </>
        )}
      </section>
      {link && organizations.length > 1 && (
        <section className="card">
          <h2>Em qual empresa a Netz trabalha no WhatsApp</h2>
          <p className="muted">Tudo o que você pedir no WhatsApp vale para a empresa marcada. Troque aqui, ou no WhatsApp escrevendo &quot;empresa&quot;.</p>
          <WhatsAppOrganizations organizations={organizations} activeId={link.organizationId} />
        </section>
      )}
    </>
  );
}
