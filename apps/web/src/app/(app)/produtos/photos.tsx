"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductImage } from "@erp/core";
import type { FormState } from "@/lib/actions";
import { FormMessage } from "@/components/form";
import { addPhotoAction, coverPhotoAction, removePhotoAction } from "./photo-actions";

const MAX_SIDE = 1600;
const MAX_PHOTOS = 8;

// Reduz a foto no navegador antes de enviar: foto de celular com 4 MB vira
// algo em torno de 200 KB, sem perder qualidade visível.
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!out) throw new Error("Não foi possível ler esta foto.");
  return { blob: out, width, height };
}

export function ProductPhotos({ productId, images, canManage }: { productId: string; images: ProductImage[]; canManage: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FormState>(null);
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, MAX_PHOTOS - images.length);
    let last: FormState = null;
    for (let i = 0; i < list.length; i++) {
      setBusy(list.length > 1 ? `Enviando ${i + 1} de ${list.length}...` : "Enviando...");
      try {
        const { blob, width, height } = await shrink(list[i]!);
        const form = new FormData();
        form.set("productId", productId);
        form.set("file", blob);
        form.set("width", String(width));
        form.set("height", String(height));
        last = await addPhotoAction(form);
        if (!last?.ok) break;
      } catch {
        last = { ok: false, message: "Não foi possível ler esta foto. Tente outra." };
        break;
      }
    }
    setBusy("");
    setState(last);
    if (input.current) input.current.value = "";
    startTransition(() => router.refresh());
  }

  const act = (fn: () => Promise<FormState>) => async () => {
    setState(await fn());
    startTransition(() => router.refresh());
  };

  return (
    <>
      <div className="card-head">
        <h2>Fotos</h2>
        {canManage && images.length < MAX_PHOTOS && (
          <>
            <button type="button" className="secondary" disabled={!!busy} onClick={() => input.current?.click()}>
              {busy || "+ Adicionar fotos"}
            </button>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={(e) => upload(e.target.files)} />
          </>
        )}
      </div>
      <FormMessage state={state} />
      {images.length === 0 ? (
        <p className="chart-empty">Nenhuma foto ainda. {canManage ? "Fotos ajudam na hora de vender e de mostrar ao cliente." : ""}</p>
      ) : (
        <div className="photo-grid">
          {images.map((img, i) => (
            <figure key={img.id} className="photo">
              <a href={`/imagens/${img.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/imagens/${img.id}`} alt="" loading="lazy" />
              </a>
              {i === 0 && <span className="photo-badge">Capa</span>}
              {canManage && (
                <figcaption>
                  {i > 0 && <button type="button" className="secondary small" onClick={act(() => coverPhotoAction(img.id))}>Tornar capa</button>}
                  <button type="button" className="secondary small" onClick={act(() => removePhotoAction(img.id))}>Remover</button>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
