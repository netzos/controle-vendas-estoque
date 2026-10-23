import { can, enabledFeatures, listBranches, listMembers, listRoles, listTelegramLinkedUsers, mailConfigured, telegramConfigured } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { AddMemberForm, EditMemberForm, PasswordLink, TelegramLink } from "./member-forms";

export const metadata = { title: "Usuários" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default async function UsersPage() {
  const actor = await requirePermission("users.view");
  const canManage = can(actor, "users.manage");
  const [members, roles, branches] = await Promise.all([
    query(listMembers, {}),
    can(actor, "roles.view") || canManage ? query(listRoles, {}) : Promise.resolve([]),
    query(listBranches, {}).catch(() => []),
  ]);
  const telegram = telegramConfigured() && (await enabledFeatures(db(), actor.organizationId)).has("telegram");
  const linked = telegram ? await listTelegramLinkedUsers(db(), actor) : new Set<string>();
  // Só o proprietário concede o perfil Proprietário.
  const assignable = roles.filter((r) => r.key !== "owner" || actor.isOwner);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <>
      <div className="page-header">
        <h1>Usuários</h1>
        <p>Quem acessa esta empresa pelo painel e pelo Telegram. Toque em uma pessoa para editar o cadastro ou gerar o link de senha e o do Telegram.</p>
      </div>
      {members.map((m) => {
        const summary = (
          <>
            {m.name} <span className="muted">{m.email}</span> <span className="tag">{m.roleName}</span>{" "}
            <span className={`tag ${m.status === "active" ? "ok" : "off"}`}>{m.status === "active" ? "Ativo" : "Desativado"}</span>
            {linked.has(m.userId) && <> <span className="tag ok">Telegram</span></>}
          </>
        );
        const details = (
          <p className="muted">
            Filiais: {m.branchIds ? m.branchIds.map((id) => branchName.get(id) ?? "?").join(", ") : "todas"} · Último acesso:{" "}
            {m.lastLoginAt ? fmt.format(new Date(m.lastLoginAt)) : "nunca"}
          </p>
        );
        const editable = canManage && m.userId !== actor.userId && (!m.isOwner || actor.isOwner);
        return editable ? (
          <details className="card" key={m.membershipId}>
            <summary>{summary} <span className="edit-hint">Editar ›</span></summary>
            {details}
            <EditMemberForm member={m} roles={assignable} branches={branches} />
            {m.status === "active" && <PasswordLink member={m} />}
            {m.status === "active" && telegram && <TelegramLink member={m} linked={linked.has(m.userId)} />}
          </details>
        ) : (
          <div className="card" key={m.membershipId}>
            <div>{summary}{m.userId === actor.userId && <span className="muted"> (você)</span>}</div>
            {details}
          </div>
        );
      })}
      {canManage && (
        <section className="card">
          <h2>Adicionar usuário</h2>
          <AddMemberForm roles={assignable} branches={branches} mailEnabled={mailConfigured()} />
        </section>
      )}
    </>
  );
}
