import Link from "next/link";
import type { FeatureRollout } from "@erp/core";

// Peças comuns das telas da Plataforma: paginação (as listas crescem para
// milhares de empresas e pessoas) e números em reais a partir do custo em dólar.

export const PAGE_SIZE = 50;

export function pageOf<T>(items: T[], page: string | undefined): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const n = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: items.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE), page: n, pages };
}

/** "Mostrando 1–50 de 1.234" com Anterior / Próxima. */
export function Pager({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  if (total === 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const n = new Intl.NumberFormat("pt-BR");
  return (
    <nav className="pager" aria-label="Páginas">
      <span className="muted">Mostrando {n.format(from)}–{n.format(to)} de {n.format(total)}</span>
      {pages > 1 && (
        <span className="pager-links">
          {page > 1 ? <Link href={href(page - 1)}>‹ Anterior</Link> : <span className="muted">‹ Anterior</span>}
          <span>Página {page} de {pages}</span>
          {page < pages ? <Link href={href(page + 1)}>Próxima ›</Link> : <span className="muted">Próxima ›</span>}
        </span>
      )}
    </nav>
  );
}

/** Monta o endereço da tela mantendo os filtros atuais. */
export function hrefWith(base: string, current: Record<string, string | undefined>, change: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v) q.set(k, v);
  return `${base}${q.size ? `?${q}` : ""}`;
}

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

export function percent(part: number, whole: number): string {
  return whole > 0 ? pct.format(part / whole) : "—";
}

/** "Todas", "Nenhuma", "Só 3 empresas", "Todas menos 2". */
export function rolloutLabel(f: FeatureRollout): { text: string; tone: string } {
  const customerExceptions = f.exceptions.filter((e) => e.kind === "customer").length;
  if (f.defaultOn) return customerExceptions ? { text: `Todas menos ${customerExceptions}`, tone: "run" } : { text: "Todas as empresas", tone: "ok" };
  return customerExceptions ? { text: `Só ${customerExceptions} ${customerExceptions === 1 ? "empresa" : "empresas"}`, tone: "run" } : { text: "Nenhuma empresa", tone: "off" };
}
