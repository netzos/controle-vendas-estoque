import { FEATURES, listPlatformOrganizations, platformFeatures } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { FeatureAll, FeatureToggle } from "./forms";

export const metadata = { title: "Liberações" };

export default async function FeaturesPage() {
  const actor = await requireDeveloper();
  const [organizations, features] = await Promise.all([
    listPlatformOrganizations(db(), actor.userId),
    platformFeatures(db(), actor.userId),
  ]);
  return (
    <>
      <div className="page-header">
        <h1>Liberações</h1>
        <p>
          Que partes do sistema cada empresa vê. Desligada, a parte some do menu e das telas daquela empresa (os dados ficam
          guardados). Novidades entram aqui desligadas, e você libera para quem quiser, quando quiser.
        </p>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Parte do sistema</th>
                {organizations.map((o) => <th key={o.id}>{o.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.key}>
                  <td>
                    <b>{f.label}</b>
                    <div className="muted">{f.description}</div>
                    <FeatureAll feature={f.key} label={f.label} />
                  </td>
                  {organizations.map((o) => {
                    const on = features.get(o.id)?.has(f.key) ?? f.defaultOn;
                    return (
                      <td key={o.id}>
                        <FeatureToggle organizationId={o.id} feature={f.key} enabled={on} label={`${f.label} para ${o.name}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
