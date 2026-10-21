import type { Db } from "@erp/db";
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password.ts";

const changePasswordInput = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual."),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    .max(200),
});

// Troca a senha e encerra as outras sessões do usuário.
export async function changePassword(
  db: Db,
  session: { userId: string; sessionId: string },
  raw: z.input<typeof changePasswordInput>,
): Promise<void> {
  const input = parseInput(changePasswordInput, raw);
  if (input.currentPassword === input.newPassword) {
    throw new AppError("invalid_input", "A nova senha deve ser diferente da atual.");
  }
  const { rows } = await db.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM controle_vendas_estoque.users WHERE id = $1",
    [session.userId],
  );
  if (!(await verifyPassword(input.currentPassword, rows[0]?.password_hash ?? null))) {
    throw new AppError("invalid_input", "A senha atual está incorreta.");
  }
  const hash = await hashPassword(input.newPassword);
  await db.query("UPDATE controle_vendas_estoque.users SET password_hash = $2, must_change_password = false WHERE id = $1", [
    session.userId,
    hash,
  ]);
  await db.query("UPDATE controle_vendas_estoque.sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [
    session.userId,
    session.sessionId,
  ]);
}
