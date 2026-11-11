"use server";

import { createWhatsAppQr, disconnectWhatsApp, getWhatsAppPlatformStatus, type WhatsAppPlatformStatus } from "@erp/core";
import { AppError } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";

export type QrResult = { ok: true; image: string; expiresIn: number } | { ok: false; message: string };

/** Consultado pela tela a cada 4 segundos enquanto está aberta. */
export async function whatsappStatusAction(): Promise<WhatsAppPlatformStatus> {
  return getWhatsAppPlatformStatus(db(), await requireDeveloper());
}

export async function whatsappQrAction(): Promise<QrResult> {
  try {
    return { ok: true, ...(await createWhatsAppQr(db(), await requireDeveloper())) };
  } catch (err) {
    return { ok: false, message: err instanceof AppError ? err.message : "Não foi possível gerar o QR Code." };
  }
}

export async function whatsappDisconnectAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    await disconnectWhatsApp(db(), await requireDeveloper());
    return { ok: true };
  } catch (err) {
    console.error("whatsapp disconnect", err);
    return { ok: false, message: "Não foi possível desconectar. Tente novamente." };
  }
}
