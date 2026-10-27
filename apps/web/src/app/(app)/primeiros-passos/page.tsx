import Link from "next/link";
import { can, listCustomers, listProducts, listSuppliers } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";

export const metadata = { title: "Primeiros passos" };

// Espaço para trazer os dados que a empresa já tem. Cada passo pode ser feito
// agora, aos poucos ou nunca: o sistema funciona com o que tiver.
export default async function OnboardingPage() {
  const actor = await requirePermission("customers.view");
  const [customers, products, suppliers] = await Promise.all([
    query(listCustomers, { limit: 500 }),
    can(actor, "products.view") ? query(listProducts, { limit: 500 }) : null,
    can(actor, "suppliers.view") ? query(listSuppliers, { limit: 500 }) : null,
  ]);
  const count = (n: number, one: string, many: string) => (n === 0 ? "Nenhum ainda" : `${n >= 500 ? "500 ou mais" : n} ${n === 1 ? one : many}`);
  const steps = [
    {
      title: "Clientes",
      text: "Tem uma lista em planilha ou em outro sistema? Traga todos de uma vez. Ou cadastre só quando vender.",
      status: count(customers.length, "cliente", "clientes"),
      done: customers.length > 0,
      links: [
        ...(can(actor, "customers.manage") ? [{ href: "/primeiros-passos/clientes", label: "Trazer de uma planilha", main: true }] : []),
        { href: "/clientes", label: "Ver clientes", main: false },
      ],
    },
    ...(products
      ? [{
          title: "Produtos",
          text: "O que você vende. Dá para começar só com nome e preço e completar depois.",
          status: count(products.length, "produto", "produtos"),
          done: products.length > 0,
          links: [{ href: "/produtos", label: "Ver produtos", main: products.length === 0 }],
        }]
      : []),
    ...(suppliers
      ? [{
          title: "Fornecedores",
          text: "De quem você compra. Opcional: só se quiser controlar compras e prazos.",
          status: count(suppliers.length, "fornecedor", "fornecedores"),
          done: suppliers.length > 0,
          links: [{ href: "/fornecedores", label: "Ver fornecedores", main: false }],
        }]
      : []),
  ];

  return (
    <>
      <div className="page-header">
        <h1>Primeiros passos</h1>
        <p>Traga o que você já tem para o netzsales. Pode fazer tudo agora ou aos poucos, no seu ritmo: o que ficar para depois não atrapalha nada.</p>
      </div>
      <div className="onboarding">
        {steps.map((s) => (
          <section key={s.title} className={`card onboarding-step${s.done ? " done" : ""}`}>
            <div className="card-head">
              <h2>{s.title}</h2>
              <span className={`tag ${s.done ? "ok" : ""}`}>{s.status}</span>
            </div>
            <p className="muted">{s.text}</p>
            <div className="actions">
              {s.links.map((l) => (
                <Link key={l.href} className={`button${l.main ? "" : " secondary"}`} href={l.href}>{l.label}</Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="muted small-text">Prefere pela conversa? Cole a lista para a Netz no Telegram ou no painel: ela mostra tudo num cartão só para você confirmar.</p>
    </>
  );
}
