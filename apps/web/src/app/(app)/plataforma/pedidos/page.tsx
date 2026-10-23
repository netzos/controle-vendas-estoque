import Link from "next/link";
import { listSignupRequests } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { whatsappLabel } from "@/lib/format";
import { RequestDecision } from "./forms";

export const metadata = { title: "Pedidos de cadastro" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function SignupRequestsPage() {
  const actor = await requireDeveloper();
  const requests = await listSignupRequests(db(), actor.userId);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <>
      <div className="page-header">
        <h1>Pedidos de cadastro</h1>
        <p>
          Quem pediu conta pela página <Link href="/criar-conta">Criar conta</Link>. Ninguém entra antes de você aprovar. Ao aprovar, a empresa
          nasce pronta e a pessoa entra com a senha que criou no pedido.
        </p>
      </div>
      {pending.length === 0 && <div className="card"><p className="muted">Nenhum pedido esperando. Os novos aparecem aqui.</p></div>}
      {pending.map((r) => (
        <section className="card request-card" key={r.id}>
          <h2>{r.organizationName}</h2>
          <p>
            <strong>{r.name}</strong> · {r.email}
            {r.whatsapp && <> · WhatsApp {whatsappLabel(r.whatsapp)}</>}
            {r.existingUser && <> · <span className="tag">Já é cliente: mais uma empresa</span></>}
            {r.telegramLinked && <> · <span className="tag ok">Já falou com a Netz no Telegram</span></>}
          </p>
          {r.business && <p className="muted">Vende: {r.business}</p>}
          <p className="muted">Pedido nº {r.number}, em {fmt.format(new Date(r.createdAt))}</p>
          <RequestDecision requestId={r.id} name={r.name.split(" ")[0]!} />
        </section>
      ))}
      {decided.length > 0 && (
        <section className="card">
          <h2>Já decididos</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Empresa</th><th>Pessoa</th><th>Situação</th><th>Quando</th></tr></thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td>{r.organizationName}</td>
                    <td>{r.name} <span className="muted">{r.email}</span></td>
                    <td>
                      <span className={`tag ${r.status === "approved" ? "ok" : "off"}`}>{r.status === "approved" ? "Aprovado" : "Recusado"}</span>
                      {r.rejectReason && <span className="muted"> {r.rejectReason}</span>}
                    </td>
                    <td className="muted">{r.decidedAt ? fmt.format(new Date(r.decidedAt)) : ""}{r.decidedByName ? ` · ${r.decidedByName}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
