"use client";

import { useActionState, useEffect, useState } from "react";
import { findOrderForFeedback, type FeedbackState } from "@/app/feedback/actions";
import { normalizePhoneInput } from "@/lib/cart";

const CUSTOMER_KEY = "ck_customer_v1";

export function FeedbackLookup() {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(findOrderForFeedback, {});
  const [phone, setPhone] = useState("");

  // Prefill the phone saved at checkout on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOMER_KEY) ?? "null") as { phone?: unknown } | null;
      if (typeof saved?.phone === "string") setPhone(normalizePhoneInput(saved.phone));
    } catch {
      // ignore
    }
  }, []);

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-stone-600">Order number</span>
        <input
          name="order_no"
          required
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="K-1001"
          className="h-14 w-full rounded-xl border-2 border-stone-200 bg-white px-3 text-xl font-semibold uppercase tracking-wide outline-none focus:border-brand-600"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-stone-600">Mobile number</span>
        <div className="flex h-14 items-center rounded-xl border-2 border-stone-200 bg-white focus-within:border-brand-600">
          <span className="pl-3 pr-1 text-base text-stone-500">+91</span>
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            value={phone}
            onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
            placeholder="98765 43210"
            className="h-full w-full rounded-r-xl bg-transparent px-2 text-lg tracking-wide outline-none"
          />
        </div>
      </label>
      {state.message && <p className="text-sm text-red-600">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-2xl bg-brand-600 text-lg font-bold text-white disabled:opacity-60"
      >
        {pending ? "Finding your order…" : "Continue"}
      </button>
    </form>
  );
}
