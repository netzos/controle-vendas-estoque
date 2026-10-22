import { can, CUSTOM_FIELD_TYPES, listCategories, listCustomFields } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { CustomFieldForm } from "./forms";

export const metadata = { title: "Campos personalizados" };

export default async function CustomFieldsPage() {
  const actor = await requirePermission("products.view");
  const [fields, categories] = await Promise.all([query(listCustomFields, { includeInactive: true }), query(listCategories, {})]);
  const canManage = can(actor, "custom_fields.manage");
  const cats = categories.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <div className="page-header">
        <h1>Campos personalizados</h1>
        <p>Informações que só o seu negócio precisa guardar em cada item: IMEI, cor, chassi, safra, validade.</p>
      </div>
      {canManage && (
        <section className="card">
          <h2>Novo campo</h2>
          <CustomFieldForm categories={cats} />
        </section>
      )}
      {fields.length === 0 && <p className="muted">Nenhum campo criado ainda.</p>}
      {fields.map((f) => {
        const info = (
          <>
            {f.label}{" "}
            <span className="muted">
              · {CUSTOM_FIELD_TYPES[f.fieldType]}
              {f.categoryName ? ` · só ${f.categoryName}` : ""}
              {f.required ? " · obrigatório" : ""}
            </span>{" "}
            {f.status === "inactive" && <span className="tag off">Inativo</span>}
          </>
        );
        return canManage ? (
          <details className="card" key={f.id}>
            <summary>{info}</summary>
            <CustomFieldForm field={f} categories={cats} />
          </details>
        ) : (
          <div className="card" key={f.id}>{info}</div>
        );
      })}
    </>
  );
}
