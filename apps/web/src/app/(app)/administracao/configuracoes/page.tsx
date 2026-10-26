import { can, enabledFeatures, getSettings } from "@erp/core";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configurações gerais" };

export default async function SettingsPage() {
  const actor = await requirePermission("settings.view");
  const [values, features] = await Promise.all([query(getSettings, {}), enabledFeatures(db(), actor.organizationId)]);
  return (
    <>
      <div className="page-header">
        <h1>Configurações gerais</h1>
        <p>Detalhes de como o netzsales mostra as informações. Para ligar recursos, volte a Ajustes.</p>
      </div>
      <section className="card">
        <SettingsForm values={values} readOnly={!can(actor, "settings.update")} deliveries={features.has("deliveries")} />
      </section>
    </>
  );
}
