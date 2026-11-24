"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { submitFeedback, type FeedbackState } from "@/app/feedback/actions";
import { FEELS, FEEL_LABEL, TASTE_FACES, TASTE_LABELS, type Feel } from "@/lib/feedback";

export function FeedbackForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(submitFeedback, {});
  const [rating, setRating] = useState<number | null>(null);
  const [spice, setSpice] = useState<Feel | null>(null);
  const [quantity, setQuantity] = useState<Feel | null>(null);

  if (state.ok) return <FeedbackThanks already={state.message === "already"} />;

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rating" value={rating ?? ""} />
      <input type="hidden" name="spice" value={spice ?? ""} />
      <input type="hidden" name="quantity_feel" value={quantity ?? ""} />

      <fieldset>
        <legend className="text-base font-semibold">Taste</legend>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {TASTE_FACES.map((face, i) => {
            const value = i + 1;
            const active = rating === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                aria-pressed={active}
                aria-label={`${value} – ${TASTE_LABELS[i]}`}
                className={`flex h-16 flex-col items-center justify-center rounded-2xl text-3xl ring-2 ${
                  active ? "bg-brand-50 ring-brand-600" : "bg-white ring-stone-200"
                }`}
              >
                {face}
              </button>
            );
          })}
        </div>
        <p className="mt-1 h-5 text-center text-sm text-stone-600">{rating ? TASTE_LABELS[rating - 1] : ""}</p>
      </fieldset>

      <FeelPicker label="Spice" value={spice} onChange={setSpice} />
      <FeelPicker label="Quantity" value={quantity} onChange={setQuantity} />

      <label className="block">
        <span className="text-base font-semibold">Anything else? (optional)</span>
        <textarea
          name="comment"
          rows={3}
          maxLength={1000}
          placeholder="Tell us what you liked or what we can do better"
          className="mt-2 w-full rounded-xl border-2 border-stone-200 bg-white p-3 text-base outline-none focus:border-brand-600"
        />
      </label>

      {state.message && !state.ok && <p className="text-sm text-red-600">{state.message}</p>}

      <button
        type="submit"
        disabled={pending || rating === null}
        className="h-14 w-full rounded-2xl bg-brand-600 text-lg font-bold text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : rating === null ? "Pick a taste rating" : "Send feedback"}
      </button>
    </form>
  );
}

function FeelPicker({ label, value, onChange }: { label: string; value: Feel | null; onChange: (f: Feel) => void }) {
  return (
    <fieldset>
      <legend className="text-base font-semibold">{label}</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {FEELS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            aria-pressed={value === f}
            className={`h-12 rounded-xl text-base font-semibold ring-2 ${
              value === f ? "bg-brand-50 text-brand-700 ring-brand-600" : "bg-white ring-stone-200"
            }`}
          >
            {FEEL_LABEL[f]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function FeedbackThanks({ already = false }: { already?: boolean }) {
  return (
    <div className="mt-8 rounded-2xl bg-green-50 p-6 text-center ring-1 ring-green-200">
      <p className="text-4xl">🙏</p>
      <p className="mt-2 text-xl font-bold">{already ? "We already have your feedback" : "Thank you!"}</p>
      <p className="mt-1 text-stone-700">Your feedback helps us cook better every weekend.</p>
      <Link
        href="/"
        className="mt-5 flex h-12 items-center justify-center rounded-xl bg-brand-600 font-bold text-white"
      >
        See next weekend&apos;s menu
      </Link>
    </div>
  );
}
