import { getOrganization, getTelegramStatus } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { ConnectTelegram, DisconnectTelegram } from "./forms";

export const metadata = { title: "Telegram" };

export default async function TelegramPage() {
  const actor = await requirePermission("nets.use");
  const [status, org] = await Promise.all([getTelegramStatus(db(), actor), query(getOrganization, {})]);
  const link = status.link;
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <div className="page-header">
        <h1>Nets no Telegram</h1>
        <p>Converse com a Nets pelo Telegram, com os mesmos dados e permissões do painel. Antes de mudar algo, ela pede confirmação com botões.</p>
      </div>
      <section className="card">
        {!status.configured ? (
          <p className="muted">O robô do Telegram ainda não foi ligado nesta instalação. Quem administra o netzsales precisa cadastrar o TELEGRAM_BOT_TOKEN na Vercel.</p>
        ) : link ? (
          <>
            <h2>Conectado</h2>
            <p>
              Telegram {link.username ? `@${link.username}` : link.firstName ?? ""} ligado em {fmt.format(link.createdAt)}
              {link.organizationId !== actor.organizationId && " a outra empresa. Toque em Conectar de novo para usar esta."}
              {link.organizationId === actor.organizationId && ` à empresa ${org.name}.`}
            </p>
            <p className="muted small-text">Para trocar de empresa no Telegram, entre na empresa aqui no painel e toque em Conectar de novo.</p>
            <div className="actions">
              <ConnectTelegram again />
              <DisconnectTelegram />
            </div>
          </>
        ) : (
          <>
            <h2>Conectar</h2>
            <ol className="steps-howto">
              <li>Toque no botão abaixo. O Telegram abre na conversa com o robô do netzsales.</li>
              <li>Toque em <strong>Iniciar</strong>. Pronto: sua conta fica ligada a {org.name}.</li>
              <li>Escreva o que precisa, como &quot;vendi 2 latas no pix&quot; ou &quot;quanto tenho em estoque?&quot;.</li>
            </ol>
            <ConnectTelegram again={false} />
            <p className="muted small-text">O link vale por 15 minutos e só uma vez.</p>
          </>
        )}
      </section>
    </>
  );
}
