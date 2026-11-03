"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * App da tela de início aberto no Início (ícones criados antes do manifest
 * abrem em "/"): vai para a conversa com a Netz, uma vez por abertura.
 */
export function AppStart() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!standalone || pathname !== "/") return;
    try {
      if (sessionStorage.getItem("netzsales.app-start")) return;
      sessionStorage.setItem("netzsales.app-start", "1");
    } catch {
      return;
    }
    router.replace("/netz");
    // Só na primeira tela da abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
