"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/lib/navigation";
import { BRAND_NAME } from "@/lib/brand";
import { Icon } from "./icons";
import { LogoMark } from "./logo";

const matches = (item: NavItem, pathname: string) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
const inGroup = (group: NavGroup, pathname: string) => (group.hub !== undefined && pathname === group.hub) || group.items.some((i) => matches(i, pathname));
const entry = (group: NavGroup) => group.hub ?? group.items[0]!.href;

export function Shell({
  navigation,
  topbar,
  user,
  logout,
  children,
}: {
  navigation: NavGroup[];
  topbar: React.ReactNode;
  user: { name: string };
  logout: (form: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = navigation.find((g) => inGroup(g, pathname));
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  // No celular, a barra de baixo mostra só as tarefas do dia; o resto fica em "Mais".
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  const more = navigation.filter((g) => !g.mobile);
  const tabs = current && !current.hub && current.items.length > 1 ? current.items : null;

  return (
    <div className="shell">
      <aside className="rail" aria-label="Menu principal">
        <Link href="/" className="rail-logo" aria-label={`${BRAND_NAME} · Início`}>
          <LogoMark size={52} />
        </Link>
        <nav className="rail-nav">
          {navigation.map((group) => (
            <Link
              key={group.label}
              href={entry(group)}
              className={`rail-item${group.primary ? " primary" : ""}${group === current ? " active" : ""}${group.mobile ? "" : " desk-only"}`}
            >
              <Icon name={group.icon} />
              <span>{group.short}</span>
            </Link>
          ))}
          <button
            type="button"
            className={`rail-item mobile-only${moreOpen || (current && !current.mobile) ? " active" : ""}`}
            aria-expanded={moreOpen}
            aria-controls="mais"
            onClick={() => setMoreOpen((o) => !o)}
          >
            <Icon name="menu" />
            <span>Mais</span>
          </button>
        </nav>
        <div className="rail-foot">
          <Link href="/conta/senha" className="rail-user" title={user.name}>
            <span className="avatar">{initials}</span>
            <span>{user.name.split(/\s+/)[0]}</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="rail-item rail-logout">
              <Icon name="logout" />
              <span>Sair</span>
            </button>
          </form>
        </div>
      </aside>
      {moreOpen && (
        <div className="more-sheet" id="mais" role="dialog" aria-label="Mais opções">
          <button type="button" className="more-backdrop" aria-label="Fechar" onClick={() => setMoreOpen(false)} />
          <div className="more-panel">
            <nav>
              {more.map((group) => (
                <Link key={group.label} href={entry(group)} className={group === current ? "active" : ""}>
                  <Icon name={group.icon} />
                  <span>{group.label}</span>
                </Link>
              ))}
            </nav>
            <div className="more-foot">
              <Link href="/conta/senha">
                <span className="avatar small">{initials}</span>
                <span>{user.name}</span>
              </Link>
              <form action={logout}>
                <button type="submit" className="secondary small">Sair</button>
              </form>
            </div>
          </div>
        </div>
      )}
      <div className="main">
        <header className="topbar">
          <div className="brand-name">
            <strong>{BRAND_NAME}</strong>
            {current && <span>{current.hint}</span>}
          </div>
          {topbar}
        </header>
        <main className="content">
          {tabs && (
            <nav className="tabs" aria-label={current!.label}>
              {tabs.map((item) => (
                <Link key={item.href} href={item.href} className={matches(item, pathname) && !tabs.some((o) => o !== item && o.href.length > item.href.length && matches(o, pathname)) ? "active" : ""}>
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          {current?.hub && pathname !== current.hub && (
            <p className="back-link"><Link href={current.hub}>← {current.short}</Link></p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

const NEW_ORGANIZATION = "__nova__";

export function OrganizationSwitcher({
  organizations,
  activeId,
  action,
  createHref,
}: {
  organizations: { id: string; name: string }[];
  activeId: string;
  action: (form: FormData) => Promise<void>;
  /** Tela para pedir mais uma empresa na mesma conta. */
  createHref?: string;
}) {
  if (organizations.length < 2) {
    return (
      <span className="org-name">
        {organizations.find((o) => o.id === activeId)?.name}
        {createHref && (
          <a href={createHref} className="org-add" title="Tem outro negócio? Crie outra empresa na mesma conta">
            + Outra empresa
          </a>
        )}
      </span>
    );
  }
  return (
    <form action={action}>
      <select
        name="organizationId"
        defaultValue={activeId}
        aria-label="Empresa ativa"
        className="org-select"
        onChange={(e) => {
          if (createHref && e.currentTarget.value === NEW_ORGANIZATION) {
            window.location.href = createHref;
            return;
          }
          e.currentTarget.form?.requestSubmit();
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
        {createHref && <option value={NEW_ORGANIZATION}>+ Criar outra empresa</option>}
      </select>
    </form>
  );
}
