"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/lib/navigation";
import { BRAND_NAME } from "@/lib/brand";
import { Icon } from "./icons";
import { LogoMark } from "./logo";

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
  // Protocolo Netzcode, regra 1: a administração tem visual próprio, inconfundível com a área do usuário.
  // A tela marca a área ativa em data-area; as cores de cada área ficam nos tokens do globals.css.
  const area = isAdminArea(pathname) ? "admin" : "user";

  return (
    <>
    {area === "admin" && (
      <div className="admin-band" role="status">
        <span className="admin-band-label">
          <Icon name="shield" size={20} />
          Modo administrador · Painel da plataforma
        </span>
        <Link href="/">Voltar para a área do usuário</Link>
      </div>
    )}
    <div className="shell" data-area={area}>
      <aside className="rail" aria-label="Menu principal">
        <Link href="/" className="rail-logo" aria-label={`${BRAND_NAME} · Início`}>
          <LogoMark size={52} />
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
          <div className="brand-name">
            <strong>{BRAND_NAME}</strong>
            {current && <span>{current.hint}</span>}
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
    </>
  );
}

/** Rotas da área de administração. Por enquanto só o Painel da plataforma (Netzcode). */
const ADMIN_PREFIXES = ["/plataforma"];

function isAdminArea(pathname: string) {
  return ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
