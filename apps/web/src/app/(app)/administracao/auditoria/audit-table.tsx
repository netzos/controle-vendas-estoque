import type { AuditLog } from "@erp/core";

const CHANNEL: Record<string, string> = { web: "Painel", telegram: "Telegram", api: "API", system: "Sistema", whatsapp: "WhatsApp" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function AuditTable({ items, timeZone }: { items: AuditLog[]; timeZone?: string }) {
  const fmt = timeZone ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }) : dateFormat;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Usuário</th>
            <th>Canal</th>
            <th>Operação</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{fmt.format(new Date(a.createdAt))}</td>
              <td>{a.actorName ?? "Sistema"}</td>
              <td><span className="tag">{CHANNEL[a.channel] ?? a.channel}</span></td>
              <td><code>{a.action}</code></td>
              <td>{a.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
