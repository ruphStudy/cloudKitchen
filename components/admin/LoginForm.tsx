"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "@/app/admin/login/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return <p className="mt-6 rounded-xl bg-green-50 p-4 text-green-900">{state.message}</p>;
  }

  return (
    <form action={action} className="mt-6 space-y-3">
      <input
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        className="h-12 w-full rounded-xl border-2 border-stone-200 bg-white px-3 text-base outline-none focus:border-brand-600"
      />
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-2xl bg-brand-600 text-lg font-bold text-white disabled:opacity-70"
      >
        {pending ? "Sending…" : "Send login link"}
      </button>
    </form>
  );
}
