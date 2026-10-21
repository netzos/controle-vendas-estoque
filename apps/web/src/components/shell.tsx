"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/lib/navigation";
import { Icon } from "./icons";

const matches = (item: NavItem, pathname: string) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));

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
  const current = navigation.find((g) => g.items.some((i) => matches(i, pathname)));
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div className="shell">
      <aside className="rail" aria-label="Menu principal">
        <Link href="/" className="rail-logo" aria-label="Início">
          <Icon name="logo" size={26} />
        </Link>
        <nav className="rail-nav">
          {navigation.map((group) => (
            <Link key={group.label} href={group.items[0]!.href} className={`rail-item${group === current ? " active" : ""}`}>
              <Icon name={group.icon} />
              <span>{group.short}</span>
            </Link>
          ))}
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
      <div className="main">
        <header className="topbar">
          <div className="crumb">
            {current && <Icon name={current.icon} size={20} />}
            <span>{current ? `${current.short} · ${current.hint}` : "Controle de vendas e estoque"}</span>
          </div>
          {topbar}
        </header>
        <main className="content">
          {current && current.items.length > 1 && (
            <nav className="tabs" aria-label={current.label}>
              {current.items.map((item) => (
                <Link key={item.href} href={item.href} className={matches(item, pathname) && !current.items.some((o) => o !== item && o.href.length > item.href.length && matches(o, pathname)) ? "active" : ""}>
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export function OrganizationSwitcher({
  organizations,
  activeId,
  action,
}: {
  organizations: { id: string; name: string }[];
  activeId: string;
  action: (form: FormData) => Promise<void>;
}) {
  if (organizations.length < 2) {
    return <span className="org-name">{organizations.find((o) => o.id === activeId)?.name}</span>;
  }
  return (
    <form action={action}>
      <select
        name="organizationId"
        defaultValue={activeId}
        aria-label="Empresa ativa"
        className="org-select"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </form>
  );
}
