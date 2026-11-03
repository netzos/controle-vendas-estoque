import { getWhatsAppPlatformStatus } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { WhatsAppConnection } from "./connection";

export const metadata = { title: "WhatsApp" };

export default async function PlatformWhatsAppPage() {
  const actor = await requireDeveloper();
  const status = await getWhatsAppPlatformStatus(db(), actor);
  return (
    <>
      <div className="page-header">
        <h1>WhatsApp</h1>
        <p>O número do netzsales no WhatsApp, conectado por QR Code como no NetzOS. Ele faz o papel do robô do Telegram: cada pessoa liga o próprio WhatsApp pelo botão no alto do painel e conversa com a Netz.</p>
      </div>
      {!status.configured ? (
        <section className="card">
          <h2>Falta ligar a ponte</h2>
          <p className="muted">
            A ponte do WhatsApp (GOWA) roda num servidor sempre ligado. Depois de subir a ponte, cadastre na Vercel as variáveis WHATSAPP_GOWA_URL,
            WHATSAPP_GOWA_USER, WHATSAPP_GOWA_PASSWORD e WHATSAPP_WEBHOOK_SECRET. O passo a passo está em deploy/whatsapp/README.md, no repositório.
          </p>
        </section>
      ) : (
        <WhatsAppConnection initial={status} />
      )}
      <section className="card">
        <h2>Cuidados</h2>
        <ul>
          <li>Use um chip só do netzsales, nunca um número pessoal ou de cliente.</li>
          <li>A Netz só responde quem escreveu para ela; nada de disparo em massa. Isso evita bloqueio do número pelo WhatsApp.</li>
          <li>Grupos e mensagens do próprio número são ignorados.</li>
        </ul>
      </section>
    </>
  );
}
