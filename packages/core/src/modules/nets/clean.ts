// Limpa a resposta da Netz antes de guardar e entregar: tira marcações
// internas do modelo que às vezes vazam para o texto (pedido nº 7, ex.:
// "antml:reasoning_effort>" no começo da resposta no Telegram).

const PATTERNS: RegExp[] = [
  // Etiquetas com prefixo de namespace interno, abertas, fechadas ou soltas.
  /<\/?antml:[^>\n]*>?/gi,
  /\bantml:[a-z_]+>?/gi,
  // Blocos de raciocínio ou de chamada de ferramenta escritos como texto.
  /<(thinking|reasoning|function_calls|invoke|parameter|system-reminder)\b[^>]*>[\s\S]*?<\/\1>/gi,
  /<\/?(thinking|reasoning|function_calls|invoke|parameter|system-reminder|result|output)\b[^>\n]*>/gi,
];

export interface CleanReply {
  text: string;
  /** Trechos tirados, para conferir depois o que saiu errado. */
  removed: string[];
}

export function cleanReply(raw: string): CleanReply {
  const removed: string[] = [];
  let text = raw;
  for (const p of PATTERNS) {
    text = text.replace(p, (m) => {
      removed.push(m.slice(0, 200));
      return "";
    });
  }
  if (!removed.length) return { text: raw, removed };
  // Sobra comum do vazamento: um ">" ou espaço solto no começo do texto.
  text = text.replace(/^[\s>]+(?=\S)/, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}
