import { can, getSettings } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configurações gerais" };

export default async function SettingsPage() {
  const actor = await requirePermission("settings.view");
  const values = await query(getSettings, {});
  return (
    <>
      <div className="page-header">
        <h1>Configurações gerais</h1>
        <p>Cada módulo acrescenta suas configurações aqui conforme for liberado.</p>
      </div>
      <section className="card">
        <SettingsForm values={values} readOnly={!can(actor, "settings.update")} />
      </section>
    </>
  );
}
