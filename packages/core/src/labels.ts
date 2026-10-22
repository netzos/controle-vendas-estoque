// Rótulos e constantes sem dependências de servidor, para uso também em
// componentes de cliente via "@erp/core/labels".

export type ItemType = "stock" | "made_to_order" | "service" | "production";

// Como o item é vendido. Define se o estoque é controlado.
export const ITEM_TYPES: Record<ItemType, { label: string; hint: string; tracksStock: boolean }> = {
  stock: { label: "Produto em estoque", hint: "Você compra, guarda e vende. Quando acabar, pode seguir vendendo por encomenda.", tracksStock: true },
  made_to_order: { label: "Só por encomenda", hint: "Não guarda em estoque. Cada venda abre a etapa Encomenda.", tracksStock: false },
  service: { label: "Serviço", hint: "Mão de obra, taxa, entrega. Não tem estoque.", tracksStock: false },
  production: { label: "Produção própria", hint: "Você mesmo produz, colhe ou fabrica. Tem estoque e pode vender por encomenda.", tracksStock: true },
};

export type CustomFieldType = "text" | "number" | "date" | "select" | "boolean";

export const CUSTOM_FIELD_TYPES: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Lista de opções",
  boolean: "Sim ou não",
};

// Etapas depois da venda (entrega, instalação, montagem...).
export type StepStatus = "pending" | "in_progress" | "done" | "cancelled";

export const STEP_STATUS: Record<StepStatus, string> = {
  pending: "A fazer",
  in_progress: "Em andamento",
  done: "Feito",
  cancelled: "Cancelado",
};

// Etapa que a venda ganha quando algo foi vendido sem ter em estoque.
export const ORDER_STEP = "Encomenda";
