import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import { z } from "zod";
import type { Actor } from "../../context.ts";
import { AppError, forbidden, notFound, parseInput } from "../../errors.ts";
import type { ImprovementViewer } from "../improvements/service.ts";

// O jeito de cada pessoa: o que a Netz aprende nas conversas sobre como a
// pessoa gosta de ser atendida (mais ou menos organizada, se gosta de ser
// lembrada, quanto detalhe quer). A Netz lê as notas ativas antes de cada
// resposta. Nada é apagado: nota substituída ou removida fica desativada.

export const PERSON_NOTES_LIMIT = 20;

export interface PersonNote {
  id: number;
  body: string;
  source: "netz" | "admin" | "person";
  replaces: number | null;
  active: boolean;
  createdAt: Date;
  endedAt: Date | null;
  endedReason: "replaced" | "removed" | null;
}

const COLUMNS = `id::int AS id, body, source, replaces::int AS replaces, active, created_at AS "createdAt", ended_at AS "endedAt", ended_reason AS "endedReason"`;

/** Notas ativas da pessoa, da mais antiga para a mais nova (para o texto da Netz). */
export async function activePersonNotes(tx: Tx, organizationId: string, userId: string): Promise<PersonNote[]> {
  const { rows } = await tx.query<PersonNote>(
    `SELECT ${COLUMNS} FROM controle_vendas_estoque.nets_person_notes
      WHERE organization_id = $1 AND user_id = $2 AND active ORDER BY id`,
    [organizationId, userId],
  );
  return rows;
}

/** Bloco do texto da Netz com o jeito desta pessoa. */
export function personNotesText(notes: PersonNote[]): string {
  if (notes.length === 0) return "O jeito desta pessoa: ainda nada anotado. Observe e anote quando ficar claro (anotar_jeito).";
  return `O jeito desta pessoa (aprendido nas conversas; siga isto):\n${notes.map((n) => `- [#${n.id}] ${n.body}`).join("\n")}`;
}

const noteInput = z.object({
  observacao: z.string().trim().min(3, "Escreva a observação.").max(500, "Use até 500 caracteres."),
  substitui: z.coerce.number().int().positive().optional(),
});

async function insertNote(
  tx: Tx,
  target: { organizationId: string; userId: string },
  body: string,
  source: PersonNote["source"],
  createdBy: string,
  replaces?: number,
): Promise<PersonNote> {
  if (replaces) {
    const old = await tx.query(
      `UPDATE controle_vendas_estoque.nets_person_notes SET active = false, ended_at = now(), ended_by = $4, ended_reason = 'replaced'
        WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND active`,
      [replaces, target.organizationId, target.userId, createdBy],
    );
    if (!old.rowCount) throw new AppError("invalid_input", `A nota #${replaces} não está ativa para esta pessoa.`);
  }
  const count = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM controle_vendas_estoque.nets_person_notes WHERE organization_id = $1 AND user_id = $2 AND active",
    [target.organizationId, target.userId],
  );
  if (count.rows[0]!.n >= PERSON_NOTES_LIMIT) {
    throw new AppError("conflict", `Esta pessoa já tem ${PERSON_NOTES_LIMIT} notas. Substitua uma que ficou velha (substitui) em vez de criar outra.`);
  }
  const { rows } = await tx.query<PersonNote>(
    `INSERT INTO controle_vendas_estoque.nets_person_notes (organization_id, user_id, body, source, replaces, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [target.organizationId, target.userId, body, source, replaces ?? null, createdBy],
  );
  return rows[0]!;
}

function asActor<T>(db: Db, actor: Actor, fn: (tx: Tx) => Promise<T>) {
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, fn);
}

/** Ferramenta da Netz: anota (ou atualiza) algo sobre o jeito da pessoa com quem conversa. */
export async function agentNotePerson(db: Db, actor: Actor, raw: z.input<typeof noteInput>) {
  if (actor.platformView) throw forbidden();
  const input = parseInput(noteInput, raw);
  return asActor(db, actor, (tx) => insertNote(tx, actor, input.observacao, "netz", actor.userId, input.substitui));
}

/** O que a Netz aprendeu sobre a própria pessoa, com o histórico. */
export async function myPersonNotes(db: Db, actor: Actor): Promise<PersonNote[]> {
  return asActor(db, actor, async (tx) => {
    const { rows } = await tx.query<PersonNote>(
      `SELECT ${COLUMNS} FROM controle_vendas_estoque.nets_person_notes
        WHERE organization_id = $1 AND user_id = $2 ORDER BY active DESC, id DESC LIMIT 100`,
      [actor.organizationId, actor.userId],
    );
    return rows;
  });
}

async function endNote(tx: Tx, id: number, by: string, where: string, params: unknown[]) {
  const r = await tx.query(
    `UPDATE controle_vendas_estoque.nets_person_notes SET active = false, ended_at = now(), ended_by = $2, ended_reason = 'removed'
      WHERE id = $1 AND active ${where}`,
    [id, by, ...params],
  );
  if (!r.rowCount) throw notFound("Nota");
}

/** A pessoa tira uma nota sobre ela. */
export async function removeMyPersonNote(db: Db, actor: Actor, id: number) {
  return asActor(db, actor, (tx) => endNote(tx, id, actor.userId, "AND organization_id = $3 AND user_id = $4", [actor.organizationId, actor.userId]));
}

/** A pessoa escreve como prefere ser atendida. */
export async function addMyPersonNote(db: Db, actor: Actor, body: string) {
  const input = parseInput(noteInput, { observacao: body });
  return asActor(db, actor, (tx) => insertNote(tx, actor, input.observacao, "person", actor.userId));
}

// Plataforma ------------------------------------------------------------------

export interface NetsPerson {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  messages: number;
  lastAt: Date | null;
  telegram: boolean;
  notes: number;
}

function assertDeveloper(viewer: ImprovementViewer) {
  if (!viewer.isDeveloper) throw forbidden("Só o administrador da plataforma vê o jeito de cada pessoa.");
}

function asViewer<T>(db: Db, viewer: ImprovementViewer, fn: (tx: Tx) => Promise<T>) {
  return withTenant(db, { organizationId: viewer.organizationId, userId: viewer.userId }, fn);
}

export async function platformNetsPeople(db: Db, viewer: ImprovementViewer): Promise<NetsPerson[]> {
  assertDeveloper(viewer);
  return asViewer(db, viewer, async (tx) => {
    const { rows } = await tx.query<NetsPerson>(
      `SELECT organization_id AS "organizationId", organization_name AS "organizationName", user_id AS "userId", user_name AS "userName",
              messages, last_at AS "lastAt", telegram, notes
         FROM controle_vendas_estoque.platform_nets_people($1)`,
      [viewer.userId],
    );
    return rows;
  });
}

export async function platformPersonNotes(db: Db, viewer: ImprovementViewer, organizationId: string, userId: string): Promise<PersonNote[]> {
  assertDeveloper(viewer);
  if (!z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(userId).success) throw notFound("Pessoa");
  return asViewer(db, viewer, async (tx) => {
    const { rows } = await tx.query<PersonNote>(
      `SELECT ${COLUMNS} FROM controle_vendas_estoque.nets_person_notes
        WHERE organization_id = $1 AND user_id = $2 ORDER BY active DESC, id DESC LIMIT 200`,
      [organizationId, userId],
    );
    return rows;
  });
}

export async function platformAddPersonNote(db: Db, viewer: ImprovementViewer, organizationId: string, userId: string, body: string, replaces?: number) {
  assertDeveloper(viewer);
  const input = parseInput(noteInput, { observacao: body, substitui: replaces });
  return asViewer(db, viewer, (tx) => insertNote(tx, { organizationId, userId }, input.observacao, "admin", viewer.userId, input.substitui));
}

export async function platformRemovePersonNote(db: Db, viewer: ImprovementViewer, id: number) {
  assertDeveloper(viewer);
  return asViewer(db, viewer, (tx) => endNote(tx, id, viewer.userId, "", []));
}
