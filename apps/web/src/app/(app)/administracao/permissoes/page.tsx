import { can, listRoles, MODULE_LABELS, PERMISSIONS } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { DeleteRoleButton, RoleForm } from "./role-forms";

export const metadata = { title: "Permissões" };

export default async function PermissionsPage() {
  const actor = await requirePermission("roles.view");
  const roles = await query(listRoles, {});
  const canManage = can(actor, "roles.manage");
  const catalog = [...PERMISSIONS];
  const modules = [...new Set(catalog.map((p) => p.module))];

  return (
    <>
      <div className="page-header">
        <h1>Permissões</h1>
        <p>
          Perfis de acesso da empresa. As mesmas permissões valem no painel, no Telegram e na API: o assistente de IA
          nunca executa algo que o perfil do usuário não permite.
        </p>
      </div>
      {roles.map((role) => (
        <details className="card" key={role.id}>
          <summary>
            {role.name} {role.isSystem && <span className="tag">padrão</span>}{" "}
            <span className="muted">{role.memberCount} usuário(s)</span>
          </summary>
          <RoleForm role={role} catalog={catalog} readOnly={!canManage} />
          {canManage && !role.isSystem && role.memberCount === 0 && <DeleteRoleButton role={role} />}
        </details>
      ))}
      {canManage && (
        <section className="card">
          <h2>Novo perfil</h2>
          <RoleForm catalog={catalog} />
        </section>
      )}
      <section className="card">
        <h2>Tudo o que dá para liberar</h2>
        {modules.map((m) => (
          <div key={m}>
            <strong>{MODULE_LABELS[m] ?? m}</strong>
            <ul>
              {catalog.filter((p) => p.module === m).map((p) => (
                <li key={p.key}>{p.description}</li>
              ))}
            </ul>
          </div>
        ))}
        <p className="muted">Novos módulos acrescentam suas permissões aqui ao serem liberados.</p>
      </section>
    </>
  );
}
