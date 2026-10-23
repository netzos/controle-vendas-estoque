import { listMyOrganizationRequests } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { AnotherOrganizationForm } from "./form";

export const metadata = { title: "Nova empresa" };

export default async function AnotherOrganizationPage() {
  const actor = await currentActor();
  const requests = await listMyOrganizationRequests(db(), actor.userId);
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
  const STATUS = { pending: ["Em análise", ""], approved: ["Aprovada", "ok"], rejected: ["Não aprovada", "off"] } as const;
  return (
    <>
      <div className="page-header">
        <h1>Nova empresa</h1>
        <p>Tem mais de um negócio? Não precisa criar outra conta. A empresa nova fica na sua conta, com o mesmo e-mail e a mesma senha.</p>
      </div>
      <section className="card">
        <ol className="steps-howto">
          <li>Informe o nome da empresa nova. O pedido passa pela aprovação da equipe do netzsales.</li>
          <li>Depois de aprovada, troque de empresa pelo seletor no alto da tela.</li>
          <li>No Telegram é o mesmo robô: envie <strong>/empresa</strong> e escolha em qual empresa a Netz deve trabalhar.</li>
        </ol>
        <AnotherOrganizationForm />
      </section>
      {requests.length > 0 && (
        <section className="card">
          <h2>Seus pedidos</h2>
          <ul className="org-choice">
            {requests.map((r) => (
              <li key={r.number}>
                <span>{r.organizationName} <span className="muted">· pedido nº {r.number} em {fmt.format(new Date(r.createdAt))}</span></span>
                <span className={`tag ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              </li>
            ))}
          </ul>
          {requests.some((r) => r.status === "approved") && (
            <p className="muted small-text">Empresa aprovada aparece no seletor do alto da tela. No Telegram, envie /empresa para trocar.</p>
          )}
        </section>
      )}
    </>
  );
}
