import { can, listStepTypes } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money } from "@/lib/format";
import { StepTypeForm } from "./forms";

export const metadata = { title: "Etapas depois da venda" };

export default async function StepTypesPage() {
  const actor = await requirePermission("deliveries.view");
  const types = await query(listStepTypes, { includeInactive: true });
  const canManage = can(actor, "deliveries.manage");
  return (
    <>
      <div className="page-header">
        <h1>Etapas depois da venda</h1>
        <p>
          O que ainda acontece depois de vender: encomenda, entrega, instalação, montagem, ou o que o seu negócio precisar. Cada etapa tem prazo,
          responsável e custo padrão, que a venda já usa quando ninguém informa outro.
        </p>
      </div>
      {canManage && (
        <section className="card">
          <h2>Nova etapa</h2>
          <StepTypeForm />
        </section>
      )}
      {types.map((t) => {
        const facts = [
          t.defaultDays === null ? null : t.defaultDays === 0 ? "no mesmo dia" : `${t.defaultDays} ${t.defaultDays === 1 ? "dia" : "dias"}`,
          t.defaultResponsible,
          t.defaultCost && Number(t.defaultCost) > 0 ? `custo ${money(t.defaultCost)}` : null,
          t.products === 0 ? null : `${t.products} ${t.products === 1 ? "produto" : "produtos"}`,
        ].filter(Boolean);
        const info = (
          <>
            {t.name}{" "}
            {facts.length > 0 && <span className="muted">· {facts.join(" · ")}</span>}{" "}
            {t.status === "inactive" && <span className="tag off">Inativa</span>}
            {t.description && <small className="muted step-type-desc">{t.description}</small>}
          </>
        );
        return canManage ? (
          <details className="card" key={t.id}>
            <summary>{info}</summary>
            <StepTypeForm type={t} />
          </details>
        ) : (
          <div className="card" key={t.id}>{info}</div>
        );
      })}
    </>
  );
}
