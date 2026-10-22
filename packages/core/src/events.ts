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
  "customer.created": { customerId: string };
  "customer.updated": { customerId: string; fields: string[] };
  "supplier.created": { supplierId: string };
  "supplier.updated": { supplierId: string; fields: string[] };
  "supplier.price_set": { supplierId: string; productId: string; agreedPrice: string; previousPrice: string | null };
  "supplier.price_removed": { supplierId: string; productId: string };
  "category.created": { categoryId: string };
  "category.updated": { categoryId: string; fields: string[] };
  "unit.created": { unitId: string };
  "unit.updated": { unitId: string; fields: string[] };
  "product.created": { productId: string };
  "product.updated": { productId: string; fields: string[] };
  "sale.created": { saleId: string; number: number; total: string };
  "sale.cancelled": { saleId: string; number: number };
  "stock.moved": { productId: string; kind: string; quantity: string; balance: string };
  "product.price_changed": { productId: string; salePrice: string; costPrice: string; previousSalePrice: string; previousCostPrice: string };
}

export type EventType = keyof DomainEvents;
