import { currentActor } from "@/lib/auth";
import { AnotherOrganizationForm } from "./form";

export const metadata = { title: "Criar outra empresa" };

export default async function AnotherOrganizationPage() {
  await currentActor();
  return (
    <>
      <div className="page-header">
        <h1>Criar outra empresa</h1>
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
    </>
  );
}
