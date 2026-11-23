"use client";

interface Props {
  quantity: number;
  canAdd: boolean;
  onChange: (quantity: number) => void;
  label: string;
}

export function QtyStepper({ quantity, canAdd, onChange, label }: Props) {
  if (quantity === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        disabled={!canAdd}
        className="h-12 min-w-24 rounded-xl border-2 border-brand-600 bg-white px-5 text-base font-bold text-brand-600 active:bg-brand-50 disabled:border-stone-300 disabled:text-stone-400"
        aria-label={`Add ${label}`}
      >
        ADD
      </button>
    );
  }

  return (
    <div className="flex h-12 items-center rounded-xl bg-brand-600 text-white">
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        className="h-12 w-12 rounded-l-xl text-2xl font-bold active:bg-brand-700"
        aria-label={`Remove one ${label}`}
      >
        −
      </button>
      <span className="w-8 text-center text-lg font-bold" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={!canAdd}
        className="h-12 w-12 rounded-r-xl text-2xl font-bold active:bg-brand-700 disabled:opacity-40"
        aria-label={`Add one more ${label}`}
      >
        +
      </button>
    </div>
  );
}
