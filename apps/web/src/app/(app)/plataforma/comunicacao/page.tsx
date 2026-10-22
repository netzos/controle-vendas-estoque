import Link from "next/link";
import { improvementViewer, netsGuidanceOverview } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { ManualEditor, type Request } from "./editor";

// A IA pode levar alguns segundos para preparar a proposta.
export const maxDuration = 120;

export const metadata = { title: "Comunicação da Netz" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const OPEN = new Set(["new", "analysis", "approved", "building"]);
const STATUS: Record<string, string> = { new: "Novo", analysis: "Em análise", approved: "Aprovado", building: "Em desenvolvimento", published: "Aplicado", rejected: "Recusado" };

export default async function CommunicationPage({ searchParams }: { searchParams: Promise<{ versao?: string }> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const o = await netsGuidanceOverview(db(), await improvementViewer(db(), actor));
  const requests: Request[] = o.requests
    .filter((r) => !r.mergedInto)
    .map((r) => ({ id: r.id, number: String(r.number), title: r.title, body: r.body, organization: r.organizationName, status: r.status, open: OPEN.has(r.status) }));
  const open = requests.filter((r) => r.open);
  const closed = requests.filter((r) => !r.open);

  return (
    <>
      <div className="page-header">
        <h1>Comunicação da Netz</h1>
        <p>
          Como a Netz conversa com as pessoas de todas as empresas. Fica separado das melhorias do sistema: aqui muda o jeito
          de falar, não as telas. Igual às instruções da IA do IONPA e ao manual (AGENTS.md) do Netz no NetzOS.
        </p>
      </div>
      <ol className="imp-steps card">
        <li><b>Pedido de ajuste</b><span>cliente, Netz ou você</span></li>
        <li><b>Proposta</b><span>a IA reescreve o manual</span></li>
        <li><b>Antes e depois</b><span>você confere e aprova</span></li>
        <li><b>Na hora</b><span>a Netz já segue na próxima mensagem</span></li>
      </ol>

      <ManualEditor
        current={{ id: o.current.id, body: o.current.body, by: o.current.by, at: o.current.at ? fmt.format(new Date(o.current.at)) : null }}
        versions={o.versions.map((v) => ({ id: v.id, note: v.note, source: v.source, improvementNumber: v.improvementNumber, by: v.by, at: fmt.format(new Date(v.at)) }))}
        requests={open}
        highlight={Number(sp.versao) || null}
      />

      {closed.length > 0 && (
        <details className="card">
          <summary>Pedidos de ajuste já encerrados ({closed.length})</summary>
          <ul className="comm-list">
            {closed.map((r) => (
              <li key={r.id}>
                <span className={`tag ${r.status === "published" ? "ok" : "off"}`}>{STATUS[r.status] ?? r.status}</span>
                <Link href={`/plataforma/melhorias?id=${r.id}&aba=${r.status === "published" ? "publicados" : "recusados"}`}>#{r.number} {r.title}</Link>
                {r.organization && <span className="muted">{r.organization}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="card">
        <summary>Regras fixas e ferramentas</summary>
        <p className="muted">
          O que o próprio sistema garante, mesmo se o manual mudar: quem a Netz é, a confirmação antes de mudar dados, as
          permissões de cada pessoa, o registro de melhorias e os limites de segurança. Isso muda só pelo código, pedindo ao Claude.
        </p>
        <pre className="comm-text">{o.rules}</pre>
        <h3>As {o.tools.length} ferramentas que a Netz pode usar</h3>
        <p className="muted">Cada pessoa só recebe as que o perfil dela permite.</p>
        <ul className="comm-tools">
          {o.tools.map((t) => <li key={t.name}><code>{t.name}</code><span>{t.description}</span></li>)}
        </ul>
      </details>
    </>
  );
}
