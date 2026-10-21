"use client";

import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/actions";

export function SubmitButton({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (pendingText ?? "Salvando...") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state?.message) return null;
  return (
    <div className={`alert ${state.ok ? "success" : "error"}`} role={state.ok ? "status" : "alert"}>
      {state.message}
    </div>
  );
}

export function Field({
  label,
  name,
  state,
  hint,
  children,
}: {
  label: string;
  name: string;
  state?: FormState;
  hint?: string;
  children: React.ReactNode;
}) {
  const error = state?.fieldErrors?.[name];
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
