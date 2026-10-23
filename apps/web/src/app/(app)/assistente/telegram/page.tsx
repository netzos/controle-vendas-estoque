import { getOrganization, getTelegramStatus, listUserOrganizations } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { ConnectTelegram, DisconnectTelegram, TelegramButton, TelegramOrganizations } from "./forms";

export const metadata = { title: "Telegram" };

export default async function TelegramPage() {
  const actor = await requirePermission("nets.use");
  const [status, org, organizations] = await Promise.all([getTelegramStatus(db(), actor), query(getOrganization, {}), listUserOrganizations(db(), actor.userId)]);
  const link = status.link;
  const here = link?.organizationId === actor.organizationId;
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <div className="page-header">
        <h1>Telegram</h1>
        <p>Converse com a Netz pelo Telegram, com os mesmos dados e permissões do painel. Antes de mudar algo, ela pede confirmação com botões.</p>
      </div>
      <section className="card">
        {!status.configured ? (
          <p className="muted">O robô do Telegram ainda não foi ligado nesta instalação. Quem administra o netzsales precisa cadastrar o TELEGRAM_BOT_TOKEN na Vercel.</p>
        ) : link ? (
          <>
            <h2>Conectado</h2>
            <p>
              Telegram {link.username ? `@${link.username}` : link.firstName ?? ""} ligado em {fmt.format(link.createdAt)}
              {here || organizations.length < 2 ? ` à empresa ${organizations.find((o) => o.id === link.organizationId)?.name ?? org.name}.` : "."}
            </p>
            <div className="actions">
              {here && <TelegramButton linked large />}
              <ConnectTelegram again />
              <DisconnectTelegram />
            </div>
          </>
        ) : (
          <>
            <h2>Conectar</h2>
            <ol className="steps-howto">
              <li>Toque no botão abaixo. O Telegram abre na conversa com a Netz.</li>
              <li>Toque em <strong>Iniciar</strong>. Pronto: sua conta fica ligada a {org.name}.</li>
              <li>Escreva ou mande áudio, como &quot;vendi 2 latas no pix&quot; ou &quot;quanto tenho em estoque?&quot;.</li>
            </ol>
            <ConnectTelegram again={false} />
            <p className="muted small-text">O botão Telegram no alto da tela faz a mesma coisa, de qualquer página.</p>
          </>
        )}
      </section>
      {link && organizations.length > 1 && (
        <section className="card">
          <h2>Em qual empresa a Netz trabalha no Telegram</h2>
          <p className="muted">Tudo o que você pedir no Telegram vale para a empresa marcada. Troque aqui, ou no Telegram enviando /empresa.</p>
          <TelegramOrganizations organizations={organizations} activeId={link.organizationId} />
        </section>
      )}
    </>
  );
}
