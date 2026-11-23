"use client";

import { useActionState } from "react";

export interface FormState {
  ok?: boolean;
  message?: string;
}

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

interface Props {
  action: Action;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "danger" | "quiet";
  confirmText?: string;
  className?: string;
}

/** Form wired to a Server Action with inline success/error feedback. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  confirmText,
  className = "",
}: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  const btn =
    variant === "danger"
      ? "bg-white text-red-600 ring-1 ring-red-200"
      : variant === "quiet"
        ? "bg-white text-stone-700 ring-1 ring-stone-300"
        : "bg-brand-600 text-white";

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`h-12 min-w-28 rounded-xl px-5 text-base font-bold disabled:opacity-60 ${btn}`}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-green-700" : "text-red-600"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export const inputCls =
  "h-12 w-full rounded-xl border-2 border-stone-200 bg-white px-3 text-base outline-none focus:border-brand-600";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-12 items-center gap-2 text-base">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-6 w-6 accent-brand-600" />
      {label}
    </label>
  );
}
