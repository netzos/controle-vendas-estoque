import Link from "next/link";
import { can, INSIGHT_PERIODS, listBranches, type InsightFilters, type InsightPeriod, type InsightRange } from "@erp/core";
import type { Actor } from "@erp/core";
import { query } from "@/lib/actions";

// Filtros do Painel ficam no endereço (?periodo=&de=&ate=&filial=&vendedor=),
// então o link guarda o recorte e as sub-abas levam o mesmo recorte junto.

export type PanelParams = { periodo?: string; de?: string; ate?: string; filial?: string; vendedor?: string };

const PERIODS: { key: InsightPeriod; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "year", label: "Este ano" },
];

const TABS = [
  { href: "/painel", label: "Visão geral" },
  { href: "/painel/vendas", label: "Vendas" },
  { href: "/painel/produtos", label: "Produtos" },
  { href: "/painel/clientes", label: "Clientes" },
];

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(p: PanelParams): InsightFilters {
  const custom = p.de && p.ate && DAY.test(p.de) && DAY.test(p.ate);
  const period = custom ? "custom" : (INSIGHT_PERIODS as readonly string[]).includes(p.periodo ?? "") && p.periodo !== "custom" ? (p.periodo as InsightPeriod) : "30d";
  return {
    period,
    from: custom ? p.de : undefined,
    to: custom ? p.ate : undefined,
    branchId: p.filial && UUID.test(p.filial) ? p.filial : undefined,
    sellerId: p.vendedor && UUID.test(p.vendedor) ? p.vendedor : undefined,
  };
}

export function panelLink(path: string, p: PanelParams, change: PanelParams = {}) {
  const merged = { ...p, ...change };
  const q = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `${path}?${q}` : path;
}

const dayFmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) === new Date().toISOString().slice(0, 4) ? "" : `/${d.slice(2, 4)}`}`;

/** "1/10 a 31/10" ou "Hoje". */
export function rangeLabel(r: InsightRange) {
  return r.from === r.to ? dayFmt(r.from) : `${dayFmt(r.from)} a ${dayFmt(r.to)}`;
}
export function previousLabel(r: InsightRange) {
  return r.prevFrom === r.prevTo ? dayFmt(r.prevFrom) : `${dayFmt(r.prevFrom)} a ${dayFmt(r.prevTo)}`;
}

export async function PanelHeader({
  actor,
  path,
  params,
  filters,
  range,
  sellers,
}: {
  actor: Actor;
  path: string;
  params: PanelParams;
  filters: InsightFilters;
  range: InsightRange;
  sellers?: { id: string; name: string }[];
}) {
  const branches = can(actor, "branches.view") ? await query(listBranches, {}) : [];
  // Só os filtros (sem período) para os links de período.
  const keep = { filial: params.filial, vendedor: params.vendedor };
  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Painel</h1>
          <p>
            {rangeLabel(range)} · comparado com {previousLabel(range)}
          </p>
        </div>
      </div>

      <nav className="segmented panel-tabs" aria-label="Partes do painel">
        {TABS.map((t) => (
          <Link key={t.href} href={panelLink(t.href, params)} className={t.href === path ? "active" : ""}>{t.label}</Link>
        ))}
      </nav>

      <div className="panel-filters">
        <nav className="segmented" aria-label="Período">
          {PERIODS.map((p) => (
            <Link key={p.key} href={panelLink(path, keep, { periodo: p.key === "30d" ? undefined : p.key })} className={filters.period === p.key ? "active" : ""}>
              {p.label}
            </Link>
          ))}
        </nav>
        <form method="get" action={path} aria-label="Escolher datas e filtros">
          {params.filial && !(branches.length > 1) && <input type="hidden" name="filial" value={params.filial} />}
          <input type="date" name="de" defaultValue={filters.period === "custom" ? range.from : undefined} aria-label="Primeiro dia" />
          <input type="date" name="ate" defaultValue={filters.period === "custom" ? range.to : undefined} aria-label="Último dia" />
          {filters.period !== "custom" && <input type="hidden" name="periodo" value={filters.period === "30d" ? "" : filters.period} />}
          {branches.length > 1 && (
            <select name="filial" defaultValue={params.filial ?? ""} aria-label="Filial">
              <option value="">Todas as filiais</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {sellers && sellers.length > 1 && (
            <select name="vendedor" defaultValue={params.vendedor ?? ""} aria-label="Vendedor">
              <option value="">Todos os vendedores</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {params.vendedor && !(sellers && sellers.length > 1) && <input type="hidden" name="vendedor" value={params.vendedor} />}
          <button type="submit" className="secondary small">Aplicar</button>
        </form>
      </div>
    </>
  );
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function dayLabel(d: string) {
  const date = new Date(`${d}T12:00:00Z`);
  return `${WEEKDAYS_SHORT[date.getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function phoneLink(phone: string | null, text: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
