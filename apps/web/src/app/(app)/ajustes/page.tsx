import Link from "next/link";
import { enabledFeatures, isPlatformDeveloper } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleNavigation } from "@/lib/nav-visible";

export const metadata = { title: "Ajustes" };

// Atalhos de tudo o que se configura uma vez, agrupados por assunto, no lugar de uma fileira de abas.
export default async function SettingsHubPage() {
  const actor = await currentActor();
  const [developer, features] = await Promise.all([isPlatformDeveloper(db(), actor.userId), enabledFeatures(db(), actor.organizationId)]);
  const group = visibleNavigation(actor, developer, features).find((g) => g.hub === "/ajustes");
  const sections = new Map<string, NonNullable<typeof group>["items"]>();
  for (const item of group?.items ?? []) {
    const key = item.section ?? "Outros";
    sections.set(key, [...(sections.get(key) ?? []), item]);
  }

  return (
    <>
      <div className="page-header">
        <h1>Ajustes</h1>
        <p>Sua empresa, a equipe e como o netzsales funciona para você. Quase tudo aqui se configura uma vez.</p>
      </div>
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
