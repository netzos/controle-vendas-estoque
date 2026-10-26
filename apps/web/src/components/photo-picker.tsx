"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkPhoto } from "@/lib/photo";

/**
 * Foto opcional dentro de um formulário: a pessoa escolhe, a foto é reduzida
 * no navegador e vai junto com o formulário no campo `name`. Com `current`,
 * mostra a foto atual e deixa trocar ou tirar (campo `${name}Remove`).
 */
export function PhotoPicker({ name, current, round = false, label = "Foto (opcional)" }: { name: string; current?: string | null; round?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(current ?? null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  async function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file || !input.current) return;
    setBusy(true);
    setError("");
    try {
      const { blob } = await shrinkPhoto(file, 1200);
      const shrunk = new File([blob], `foto.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type });
      const list = new DataTransfer();
      list.items.add(shrunk);
      input.current.files = list.files;
      setPreview(URL.createObjectURL(shrunk));
      setRemoved(false);
    } catch {
      input.current.value = "";
      setError("Não foi possível ler esta foto. Tente outra.");
    }
    setBusy(false);
  }

  function clear() {
    if (input.current) input.current.value = "";
    setPreview(null);
    setRemoved(Boolean(current));
  }

  return (
    <div className="field photo-picker">
      <span className="label">{label}</span>
      <div className="photo-picker-row">
        <button type="button" className={`photo-slot${round ? " round" : ""}`} onClick={() => input.current?.click()} aria-label={preview ? "Trocar foto" : "Escolher foto"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" /> : <span>+</span>}
        </button>
        <div className="photo-picker-actions">
          <button type="button" className="secondary small" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Preparando..." : preview ? "Trocar" : "Escolher foto"}
          </button>
          {preview && <button type="button" className="secondary small" onClick={clear}>Tirar</button>}
        </div>
      </div>
      <input ref={input} type="file" name={name} accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => choose(e.target.files)} />
      {removed && <input type="hidden" name={`${name}Remove`} value="1" />}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
