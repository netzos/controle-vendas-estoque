// Erros de domínio com códigos estáveis. Os mesmos códigos chegam ao painel,
// à API e às ferramentas da IA (ToolResult.code).
export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "ambiguous"
  | "confirmation_required"
  | "rate_limited"
  | "unavailable";

export interface Candidate {
  id: string;
  label: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly candidates?: Candidate[];

  constructor(code: ErrorCode, message: string, opts: { details?: Record<string, unknown>; candidates?: Candidate[] } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = opts.details;
    this.candidates = opts.candidates;
  }
}

export const forbidden = (message = "Você não tem permissão para esta operação.") => new AppError("forbidden", message);
export const notFound = (what: string) => new AppError("not_found", `${what} não encontrado(a).`);
export const conflict = (message: string) => new AppError("conflict", message);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// Traduz violações de restrição do PostgreSQL em erros de domínio.
export function fromPgError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23505") return new AppError("conflict", "Já existe um registro com estes dados.", { details: { constraint: e.constraint } });
  if (e?.code === "23503") return new AppError("conflict", "O registro está vinculado a outros dados.", { details: { constraint: e.constraint } });
  if (e?.code === "23514") return new AppError("invalid_input", "Os dados não atendem às regras do cadastro.", { details: { constraint: e.constraint } });
  return err;
}

// Validação com erro de domínio (para funções fora de runService).
export function parseInput<S extends import("zod").ZodType>(schema: S, raw: unknown): import("zod").output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError("invalid_input", first?.message ?? "Dados inválidos.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  return parsed.data;
}
