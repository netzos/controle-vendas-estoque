"use server";

import { createMovement } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

export async function createMovementAction(_: FormState, form: FormData): Promise<FormState> {
  const kind = str(form, "kind");
  return perform(
    createMovement,
    {
      productId: str(form, "productId"),
      kind: kind === "out" || kind === "adjust" ? kind : "in",
      quantity: str(form, "quantity"),
      unitCost: optional(form, "unitCost"),
      notes: optional(form, "notes"),
    },
    { successMessage: "Estoque atualizado.", revalidate: "/estoque" },
  );
}
