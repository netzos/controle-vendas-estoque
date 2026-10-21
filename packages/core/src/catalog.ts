import type { Db } from "@erp/db";
import { withTransaction } from "@erp/db";
import { PERMISSIONS } from "./permissions.ts";

// Sincroniza erp.permissions com o catálogo do código e concede permissões
// novas ao perfil padrão Administrador de todas as empresas. Executado pelo
// comando de migração, com o papel dono das tabelas (fora do RLS).
export async function syncPermissionCatalog(db: Db) {
  return withTransaction(db, async (tx) => {
    const keys = PERMISSIONS.map((p) => p.key);
    await tx.query(
      `INSERT INTO erp.permissions (key, module, description, risk_level)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::smallint[])
       ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, risk_level = EXCLUDED.risk_level`,
      [keys, PERMISSIONS.map((p) => p.module), PERMISSIONS.map((p) => p.description), PERMISSIONS.map((p) => p.risk)],
    );
    const removed = await tx.query("DELETE FROM erp.permissions WHERE NOT (key = ANY($1::text[]))", [keys]);
    const granted = await tx.query(
      `INSERT INTO erp.role_permissions (organization_id, role_id, permission_key)
       SELECT r.organization_id, r.id, p.key
         FROM erp.roles r CROSS JOIN erp.permissions p
        WHERE r.is_system AND r.key IN ('owner', 'admin')
       ON CONFLICT DO NOTHING`,
    );
    return { total: keys.length, removed: removed.rowCount ?? 0, grantedToAdmins: granted.rowCount ?? 0 };
  });
}
