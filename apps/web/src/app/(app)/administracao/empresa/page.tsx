import { can, getOrganization } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { OrganizationForm } from "./organization-form";

export const metadata = { title: "Empresa" };

export default async function OrganizationPage() {
  const actor = await requirePermission("organization.view");
  const org = await query(getOrganization, {});
  const timezones = Intl.supportedValuesOf("timeZone").filter((tz) => tz.startsWith("America/") || tz === org.timezone);
  return (
    <>
      <div className="page-header">
        <h1>Empresa</h1>
        <p>Dados cadastrais usados em documentos, relatórios e mensagens.</p>
      </div>
      <section className="card">
        <OrganizationForm org={org} timezones={timezones} readOnly={!can(actor, "organization.update")} />
      </section>
    </>
  );
}
