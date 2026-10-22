import Link from "next/link";
import { notFound } from "next/navigation";
import { featureRollouts, isFeatureKey, listPlatformOrganizations } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { rolloutLabel } from "../../ui";
import { FeatureDefault, FeatureToggle } from "../forms";

export const metadata = { title: "Liberação" };

export default async function FeaturePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ q?: string }> }) {
  const actor = await requireDeveloper();
  const { key } = await params;
  const { q } = await searchParams;
  if (!isFeatureKey(key)) notFound();
  const [features, orgs] = await Promise.all([featureRollouts(db(), actor.userId), listPlatformOrganizations(db(), actor.userId)]);
  const f = features.find((x) => x.key === key)!;
  const r = rolloutLabel(f);
  const exceptionIds = new Set(f.exceptions.map((e) => e.id));
  const term = (q ?? "").trim().toLowerCase();
  const found = term
    ? orgs.filter((o) => !exceptionIds.has(o.id) && [o.name, o.ownerName, o.ownerEmail].some((v) => v?.toLowerCase().includes(term))).slice(0, 20)
    : [];

  return (
    <>
      <p className="back-link"><Link href="/plataforma/liberacoes">‹ Todas as liberações</Link></p>
      <div className="page-header">
        <h1>{f.label}</h1>
        <p>{f.description} <span className={`tag ${r.tone}`}>{r.text}</span> {f.enabledCount} de {f.total} empresas clientes.</p>
      </div>

      <section className="card">
        <h2>Padrão</h2>
        <p className="muted">
          Vale para todas as empresas, inclusive as que entrarem depois. Mudar o padrão desfaz todas as exceções abaixo.
        </p>
        <FeatureDefault feature={f.key} label={f.label} defaultOn={f.defaultOn} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Exceções</h2>
          <span className="muted">{f.exceptions.length === 0 ? "nenhuma" : `${f.exceptions.length} ${f.exceptions.length === 1 ? "empresa" : "empresas"} fora do padrão`}</span>
        </div>
        <p className="muted">
          {f.defaultOn ? "Empresas que não têm esta parte, embora o padrão seja ligado." : "Empresas que têm esta parte, embora o padrão seja desligado."}
        </p>
        {f.exceptions.length > 0 && (
          <ul className="feature-list">
            {f.exceptions.map((e) => (
              <li key={e.id}>
                <div>
                  <Link href={`/plataforma/empresas/${e.id}`}><b>{e.name}</b></Link>
                  {e.kind === "internal" && <span className="tag">Interna</span>}
                </div>
                <FeatureToggle organizationId={e.id} feature={f.key} enabled={e.enabled} label={`${f.label} para ${e.name}`} />
              </li>
            ))}
          </ul>
        )}
        <h3>Adicionar exceção</h3>
        <form method="get" className="org-search">
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Buscar empresa pelo nome, dono ou e-mail" aria-label="Buscar empresa" />
        </form>
        {term && found.length === 0 && <p className="muted">Nenhuma empresa encontrada (ou ela já está nas exceções).</p>}
        {found.length > 0 && (
          <ul className="feature-list">
            {found.map((o) => (
              <li key={o.id}>
                <div><b>{o.name}</b> <span className="muted">{o.ownerName ?? ""}</span>{o.kind === "internal" && <span className="tag">Interna</span>}</div>
                <FeatureToggle organizationId={o.id} feature={f.key} enabled={f.defaultOn} label={`${f.label} para ${o.name}`} actionText={f.defaultOn ? "Desligar para esta" : "Ligar para esta"} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
