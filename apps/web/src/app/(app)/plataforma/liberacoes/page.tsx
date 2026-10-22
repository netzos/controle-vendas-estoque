import Link from "next/link";
import { featureRollouts } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { rolloutLabel } from "../ui";

export const metadata = { title: "Liberações" };

export default async function FeaturesPage() {
  const actor = await requireDeveloper();
  const features = await featureRollouts(db(), actor.userId);
  return (
    <>
      <div className="page-header">
        <h1>Liberações</h1>
        <p>
          Que partes do sistema as empresas veem. Cada parte tem um padrão, que vale para todas as empresas e para as novas, e as
          exceções, empresa por empresa. Desligada, a parte some do menu e das telas (os dados ficam guardados). Novidades entram
          desligadas, e você libera para quem quiser.
        </p>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Parte do sistema</th><th>Quem tem</th><th>Empresas com ela</th><th /></tr></thead>
            <tbody>
              {features.map((f) => {
                const r = rolloutLabel(f);
                return (
                  <tr key={f.key}>
                    <td><Link href={`/plataforma/liberacoes/${f.key}`} className="org-link">{f.label}</Link><div className="muted">{f.description}</div></td>
                    <td><span className={`tag ${r.tone}`}>{r.text}</span></td>
                    <td>{f.enabledCount} de {f.total}</td>
                    <td><Link href={`/plataforma/liberacoes/${f.key}`}>Gerenciar ›</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
