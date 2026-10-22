import type { OrganizationHealth } from "@erp/core";

export const HEALTH_TONE: Record<OrganizationHealth, string> = {
  active: "ok",
  cooling: "run",
  idle: "warn",
  never: "off",
  suspended: "warn",
};

const DAY = 24 * 60 * 60 * 1000;
const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** "hoje", "ontem", "há 5 dias" ou a data. */
export function sinceLabel(at: Date | null): string {
  if (!at) return "nunca";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / DAY);
  if (days < 1) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  return dateFmt.format(new Date(at));
}
