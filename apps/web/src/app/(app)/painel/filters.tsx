import Link from "next/link";
import { can, INSIGHT_PERIODS, listBranches, type InsightFilters, type InsightPeriod, type InsightRange } from "@erp/core";
import type { Actor } from "@erp/core";
import { query } from "@/lib/actions";
import { PeriodPicker } from "@/components/period-picker";

// Padrão: últimos 7 dias. Filtros do Painel ficam no endereço (?periodo=&de=&ate=&filial=&vendedor=),
// então o link guarda o recorte e as sub-abas levam o mesmo recorte junto.

export type PanelParams = { periodo?: string; de?: string; ate?: string; filial?: string; vendedor?: string; agrupar?: string };

const GROUPS = { dia: "day", semana: "week", mes: "month" } as const;

const PERIODS: { key: InsightPeriod; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
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
  const period = custom ? "custom" : (INSIGHT_PERIODS as readonly string[]).includes(p.periodo ?? "") && p.periodo !== "custom" ? (p.periodo as InsightPeriod) : "7d";
  return {
    period,
    from: custom ? p.de : undefined,
    to: custom ? p.ate : undefined,
    branchId: p.filial && UUID.test(p.filial) ? p.filial : undefined,
    sellerId: p.vendedor && UUID.test(p.vendedor) ? p.vendedor : undefined,
    group: p.agrupar && p.agrupar in GROUPS ? GROUPS[p.agrupar as keyof typeof GROUPS] : undefined,
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
  // Período atual (sem as datas) e filtros, para montar cada link.
  const periodo = filters.period === "custom" ? undefined : filters.period === "7d" ? undefined : filters.period;
  const dates = filters.period === "custom" ? { de: range.from, ate: range.to } : {};
  const keep = { filial: params.filial, vendedor: params.vendedor };
  const links = Object.fromEntries(PERIODS.map((p) => [p.key, panelLink(path, keep, { periodo: p.key === "7d" ? undefined : p.key })]));
  const current = { periodo, ...dates, ...keep };
  const label = filters.period === "custom" ? "Período escolhido" : PERIODS.find((p) => p.key === filters.period)?.label ?? "Período";
  const showSellers = sellers && sellers.length > 1;
  const choiceLinks = (key: "filial" | "vendedor", list: { id: string }[]) =>
    Object.fromEntries([["", panelLink(path, current, { [key]: undefined })], ...list.map((b) => [b.id, panelLink(path, current, { [key]: b.id })])]);
  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Painel</h1>
          <p>Comparado com o período anterior ({previousLabel(range)})</p>
        </div>
      </div>

      <div className="panel-toolbar">
      <nav className="segmented panel-tabs" aria-label="Partes do painel">
        {TABS.map((t) => (
          <Link key={t.href} href={panelLink(t.href, params)} className={t.href === path ? "active" : ""}>{t.label}</Link>
        ))}
      </nav>

      <PeriodPicker
        options={PERIODS}
        current={filters.period}
        label={label}
        range={rangeLabel(range)}
        from={range.from}
        to={range.to}
        links={links}
        customLink={panelLink(path, keep)}
        branches={branches.length > 1 ? branches.map((b) => ({ id: b.id, name: b.name })) : undefined}
        branch={params.filial}
        branchLinks={branches.length > 1 ? choiceLinks("filial", branches) : undefined}
        sellers={showSellers ? sellers : undefined}
        seller={params.vendedor}
        sellerLinks={showSellers ? choiceLinks("vendedor", sellers) : undefined}
      />
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
