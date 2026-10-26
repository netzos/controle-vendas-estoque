import Link from "next/link";
import { can, companyFeatureChoices, enabledFeatures, isPlatformDeveloper } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleNavigation } from "@/lib/nav-visible";
import { FeatureSwitches } from "./features";

export const metadata = { title: "Ajustes" };

// Primeiro os recursos que a empresa liga ou desliga (o netzsales se adapta ao
// negócio); depois os atalhos do que se configura uma vez, por assunto.
export default async function SettingsHubPage() {
  const actor = await currentActor();
  const [developer, features, choices] = await Promise.all([
    isPlatformDeveloper(db(), actor.userId),
    enabledFeatures(db(), actor.organizationId),
    companyFeatureChoices(db(), actor.organizationId),
  ]);
  const group = visibleNavigation(actor, developer, features).find((g) => g.hub === "/ajustes");
  const sections = new Map<string, NonNullable<typeof group>["items"]>();
  for (const item of group?.items ?? []) {
    const key = item.section ?? "Outros";
    sections.set(key, [...(sections.get(key) ?? []), item]);
  }
  const canChange = can(actor, "settings.update") && !actor.platformView;

  return (
    <>
      <div className="page-header">
        <h1>Ajustes</h1>
        <p>O netzsales já vem pronto para vender. Ligue só o que o seu negócio usa; o resto fica escondido.</p>
      </div>
      {choices.length > 0 && can(actor, "settings.view") && (
        <section className="hub-section">
          <h2>Recursos do seu negócio</h2>
          <p className="muted section-hint">
            Sempre ligados: vender, produtos, estoque, clientes e fornecedores.
            {!canChange && " Só quem pode alterar as configurações liga ou desliga estes recursos."}
          </p>
          <FeatureSwitches features={choices} canChange={canChange} />
        </section>
      )}
      {[...sections].map(([section, items]) => (
        <section key={section} className="hub-section">
          <h2>{section}</h2>
          <div className="hub-grid">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="card hub-card">
                <strong>{item.label}</strong>
                {item.description && <span className="muted">{item.description}</span>}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
