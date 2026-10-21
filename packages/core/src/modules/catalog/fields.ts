import { z } from "zod";

// Campos compartilhados pelos cadastros. Aceitam o que a pessoa digita
// ("123.456.789-09", "12,50") e normalizam antes de gravar.

function cpfValid(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(d[len])) return false;
  }
  return true;
}

function cnpjValid(d: string): boolean {
  if (/^(\d)\1{13}$/.test(d)) return false;
  for (const len of [12, 13]) {
    let sum = 0;
    let weight = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (digit !== Number(d[len])) return false;
  }
  return true;
}

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const documentField = z.preprocess(
  emptyToNull,
  z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((d) => (d.length === 11 ? cpfValid(d) : d.length === 14 ? cnpjValid(d) : false), "CPF ou CNPJ inválido.")
    .nullable()
    .optional(),
);

export const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

export const emailField = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().email("E-mail inválido.").max(160).nullable().optional(),
);

export const stateField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a sigla do estado, por exemplo SP.")
    .nullable()
    .optional(),
);

// Valor em reais ou quantidade, com vírgula ou ponto. Devolvido como texto
// para ir ao banco como numeric, sem passar por ponto flutuante.
export const decimalField = (scale: number, label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const t = v.trim().replace(/^R\$\s*/, "");
      if (t === "") return "0";
      // "1.234,56" → "1234.56"; "12.5" continua "12.5".
      return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
    },
    z
      .string()
      .regex(new RegExp(`^\\d{1,10}(\\.\\d{1,${scale}})?$`), `${label}: use um número com até ${scale} casas decimais.`),
  );

export const statusField = z.enum(["active", "inactive"]).default("active");

export const uuidOrNull = z.preprocess(emptyToNull, z.string().uuid().nullable().optional());
