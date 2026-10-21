"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENT_PHASE, type NavGroup } from "@/lib/navigation";

export function Shell({ navigation, topbar, children }: { navigation: NavGroup[]; topbar: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className={`shell${open ? " nav-open" : ""}`}>
      <aside className="sidebar" aria-label="Menu principal" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="brand">Controle de vendas e estoque</div>
        {navigation.map((group) => (
          <nav className="nav-group" key={group.label} aria-label={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) =>
              item.phase > CURRENT_PHASE ? (
                <span key={item.href} className="nav-item disabled" title={`Disponível na fase ${item.phase}`}>
                  {item.label}
                  <span className="phase-badge">Fase {item.phase}</span>
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${(item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? " active" : ""}`}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="secondary menu-toggle" onClick={() => setOpen(true)} aria-label="Abrir menu">
            Menu
          </button>
          {topbar}
        </header>
        <main className="content">{children}</main>
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
    return <strong>{organizations.find((o) => o.id === activeId)?.name}</strong>;
  }
  return (
    <form action={action}>
      <select
        name="organizationId"
        defaultValue={activeId}
        aria-label="Empresa ativa"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </form>
  );
}
