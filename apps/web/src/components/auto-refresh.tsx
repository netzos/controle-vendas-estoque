"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Atualiza a tela sozinha de tempos em tempos (painéis "ao vivo"), só com a aba visível. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="live-badge" title={`Atualiza sozinho a cada ${seconds} segundos`}>
      <i /> Ao vivo · {at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
