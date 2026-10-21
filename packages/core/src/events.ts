// Eventos de domínio publicados pelo outbox. Cada fase acrescenta os seus.
// O payload deve conter só identificadores e valores necessários; quem consome
// relê o estado atual do banco.
export interface DomainEvents {
  "organization.created": { organizationId: string; name: string };
  "organization.updated": { organizationId: string; fields: string[] };
  "branch.created": { branchId: string };
  "branch.updated": { branchId: string; fields: string[] };
  "member.added": { membershipId: string; userId: string; roleKey: string };
  "member.updated": { membershipId: string; userId: string; fields: string[] };
  "role.created": { roleId: string; key: string };
  "role.updated": { roleId: string; fields: string[] };
  "role.deleted": { roleId: string; key: string };
  "settings.updated": { key: string };
}

export type EventType = keyof DomainEvents;
