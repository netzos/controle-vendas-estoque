// Formatação para exibição. Valores numeric chegam do banco como texto.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(value: string | number): string {
  return brl.format(Number(value));
}

export function quantity(value: string | number, decimals = 0): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: 3 }).format(Number(value));
}

// Valor para campo de formulário: "12.50" → "12,50".
export function decimalInput(value: string | undefined, decimals: number): string {
  if (value === undefined) return "";
  const n = Number(value);
  return n === 0 ? "" : n.toFixed(decimals).replace(".", ",");
}

export function documentLabel(doc: string | null): string {
  if (!doc) return "";
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}
