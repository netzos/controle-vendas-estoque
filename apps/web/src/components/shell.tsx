"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { NavGroup, NavItem } from "@/lib/navigation";
import { BRAND_NAME } from "@/lib/brand";
import { Icon } from "./icons";
import { LogoMark } from "./logo";

const matches = (item: NavItem, pathname: string) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
const inGroup = (group: NavGroup, pathname: string) => (group.hub !== undefined && pathname === group.hub) || group.items.some((i) => matches(i, pathname));
/** Endereço mais comprido que casa com a página: /plataforma/empresas ganha de /plataforma. */
const depth = (group: NavGroup, pathname: string) =>
  Math.max(group.hub === pathname ? pathname.length : -1, ...group.items.filter((i) => matches(i, pathname)).map((i) => i.href.length));
/** Item ativo entre irmãos: o de endereço mais comprido que casa com a página. */
const isActive = (items: NavItem[], item: NavItem, pathname: string) =>
  matches(item, pathname) && !items.some((o) => o !== item && o.href.length > item.href.length && matches(o, pathname));
const entry = (group: NavGroup) => group.hub ?? group.items[0]!.href;

/** Busca sem acento e sem maiúscula: "estoq" acha "Estoque". */
const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const MENU_KEY = "netzsales.menu";

export function Shell({
  navigation,
  topbar,
  user,
  logout,
  viewMode = false,
  children,
}: {
  navigation: NavGroup[];
  topbar: React.ReactNode;
  user: { name: string };
  logout: (form: FormData) => Promise<void>;
  /** Administrador olhando o painel de um cliente: cor diferente e tudo travado. */
  viewMode?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navigation
    .filter((g) => inGroup(g, pathname))
    .reduce<NavGroup | undefined>((best, g) => (!best || depth(g, pathname) > depth(best, pathname) ? g : best), undefined);
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  // No celular, a barra de baixo mostra só as tarefas do dia; o resto fica em "Mais".
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  const more = navigation.filter((g) => !g.mobile);
  const tabs = current && !current.hub && current.items.length > 1 ? current.items : null;

  // Menu lateral de vidro: aberto (ícone + nome) ou recolhido (só ícones), lembrado neste navegador.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(MENU_KEY) === "recolhido");
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(MENU_KEY, c ? "aberto" : "recolhido");
      } catch {}
      return !c;
    });

  // Grupos com várias telas abrem uma árvore embaixo; o grupo da página atual já vem aberto.
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.label] : []));
  useEffect(() => {
    if (current) setOpen((o) => (o.has(current.label) ? o : new Set(o).add(current.label)));
  }, [current]);
  const flip = (label: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });

  // Buscar telas (Ctrl+K ou ⌘K).
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(""), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCollapsed(false);
        setTimeout(() => search.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const results = query.trim()
    ? navigation.flatMap((g) =>
        g.items
          .filter((i) => plain(`${i.label} ${g.label} ${i.description ?? ""}`).includes(plain(query.trim())))
          .map((i) => ({ ...i, group: g })),
      )
    : null;
  const areas = [...new Set(navigation.map((g) => g.area))];

  return (
    <div className={`shell${viewMode ? " view-mode" : ""}${collapsed ? " collapsed" : ""}`}>
      <aside className="side" aria-label="Menu principal">
        <button
          type="button"
          className="side-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Abrir o menu" : "Recolher o menu"}
          aria-expanded={!collapsed}
        >
          <Icon name="chevron" size={16} />
        </button>
        <Link href="/" className="side-brand" aria-label={`${BRAND_NAME} · Início`}>
          <LogoMark size={40} />
          <span className="side-label">
            <strong>{BRAND_NAME}</strong>
            <small>Vendas e estoque</small>
          </span>
        </Link>
        <div className="side-search">
          <button
            type="button"
            className="side-search-icon"
            aria-label="Buscar telas"
            data-tip="Buscar"
            onClick={() => {
              setCollapsed(false);
              setTimeout(() => search.current?.focus(), 50);
            }}
          >
            <Icon name="search" size={18} />
          </button>
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.[0]) router.push(results[0].href);
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Buscar telas"
            aria-label="Buscar telas"
          />
          <kbd>⌘K</kbd>
        </div>
        <nav className="side-nav">
          {results ? (
            <div className="side-area">
              <p className="side-title">{results.length ? "Telas encontradas" : "Nenhuma tela com esse nome"}</p>
              {results.map((r) => (
                <Link key={r.href} href={r.href} className="side-item">
                  <Icon name={r.group.icon} size={20} />
                  <span className="side-label">
                    {r.label}
                    {r.label !== r.group.label && <small> · {r.group.short}</small>}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            areas.map((area) => (
              <div key={area} className="side-area">
                <p className="side-title">{area}</p>
                {navigation
                  .filter((g) => g.area === area)
                  .map((group) => {
                    const tree = !group.hub && group.items.length > 1;
                    const expanded = tree && open.has(group.label);
                    return (
                      <div key={group.label} className="side-group">
                        <div className="side-row">
                          <Link
                            href={entry(group)}
                            data-tip={group.short}
                            aria-current={group === current ? "page" : undefined}
                            className={`side-item${group.primary ? " primary" : ""}${group === current ? " active" : ""}`}
                          >
                            <Icon name={group.icon} size={20} />
                            <span className="side-label">{group.short}</span>
                          </Link>
                          {tree && (
                            <button
                              type="button"
                              className={`side-caret${expanded ? " open" : ""}`}
                              aria-label={`${expanded ? "Fechar" : "Abrir"} ${group.short}`}
                              aria-expanded={expanded}
                              onClick={() => flip(group.label)}
                            >
                              <Icon name="chevron" size={14} />
                            </button>
                          )}
                        </div>
                        {expanded && (
                          <div className="side-tree">
                            {group.items.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                className={isActive(group.items, item, pathname) ? "active" : ""}
                              >
                                <i aria-hidden="true" />
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))
          )}
        </nav>
        <div className="side-foot">
          <Link href="/conta/senha" className="side-user" title={user.name} data-tip={user.name}>
            <span className="avatar">{initials}<i aria-hidden="true" /></span>
            <span className="side-label">
              <strong>{user.name}</strong>
              <small>Minha conta</small>
            </span>
          </Link>
          <form action={logout}>
            <button type="submit" className="side-logout" aria-label="Sair" data-tip="Sair">
              <Icon name="logout" size={18} />
            </button>
          </form>
        </div>
      </aside>
      <nav className="mbar" aria-label="Menu principal">
        {navigation
          .filter((g) => g.mobile)
          .map((group) => (
            <Link
              key={group.label}
              href={entry(group)}
              className={`mbar-item${group.primary ? " primary" : ""}${group === current ? " active" : ""}`}
            >
              <Icon name={group.icon} />
              <span>{group.short}</span>
            </Link>
          ))}
        <button
          type="button"
          className={`mbar-item mbar-more${moreOpen || (current && !current.mobile) ? " active" : ""}`}
          aria-expanded={moreOpen}
          aria-controls="mais"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon name="menu" />
          <span>Mais</span>
        </button>
      </nav>
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
            {/* No computador o nome fica no menu de vidro; no celular, aqui no topo. */}
            <Link href="/" className="mobile-brand" aria-label={`${BRAND_NAME} · Início`}>
              <LogoMark size={34} />
              <strong>{BRAND_NAME}</strong>
            </Link>
            {current && <span>{current.hint}</span>}
          </div>
          {topbar}
        </header>
        <main className="content">
          {tabs && (
            <nav className="tabs" aria-label={current!.label}>
              {tabs.map((item) => (
                <Link key={item.href} href={item.href} className={isActive(tabs, item, pathname) ? "active" : ""}>
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
