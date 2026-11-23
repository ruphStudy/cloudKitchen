"use client";

import { useState, useTransition } from "react";
import { setOrderStatus, type StatusAction } from "@/app/admin/actions";
import type { AdminOrder } from "@/lib/admin-data";
import { isStalePending } from "@/lib/availability";
import { formatPaise } from "@/lib/format";

function Badge({ order, now }: { order: AdminOrder; now: number }) {
  const map: Record<string, [string, string]> = {
    paid: ["Paid", "bg-blue-100 text-blue-800"],
    ready: ["Ready", "bg-green-100 text-green-800"],
    picked_up: ["Picked up", "bg-stone-200 text-stone-700"],
    cancelled: ["Cancelled", "bg-red-100 text-red-800"],
  };
  let [label, cls] = map[order.status] ?? ["", ""];
  if (order.status === "pending_payment") {
    [label, cls] = isStalePending(order, now)
      ? ["Unpaid (expired)", "bg-stone-100 text-stone-500"]
      : ["Awaiting payment", "bg-amber-100 text-amber-800"];
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function formatPhone(p: string): string {
  return `${p.slice(0, 5)} ${p.slice(5)}`;
}

export function OrderRow({ order, now }: { order: AdminOrder; now: number }) {
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: StatusAction) {
    setError(null);
    startTransition(async () => {
      const res = await setOrderStatus(order.id, action);
      if (!res.ok) setError(res.message ?? "Something went wrong.");
      setConfirmCancel(false);
    });
  }

  const refundNeeded = order.status === "cancelled" && !!order.razorpay_payment_id;
  const canCancel = order.status === "pending_payment" || order.status === "paid" || order.status === "ready";
  const dim = order.status === "picked_up" || order.status === "cancelled";

  return (
    <li className={`rounded-2xl bg-white p-3 ring-1 ring-stone-200 ${dim ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{order.order_no}</span>
            <Badge order={order} now={now} />
            {refundNeeded && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">Refund needed</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-base">{order.customer_name}</p>
          <a href={`tel:+91${order.customer_phone}`} className="inline-block py-1 text-base font-semibold text-brand-600">
            📞 {formatPhone(order.customer_phone)}
          </a>
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums">{formatPaise(order.total_paise)}</span>
      </div>

      <p className="mt-1 text-base">
        {order.items.map((it, i) => (
          <span key={it.menu_item_id}>
            {i > 0 && ", "}
            <b>{it.quantity}×</b> {it.name.replace(/ bowl$/i, "")}
          </span>
        ))}
      </p>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {confirmCancel ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3">
          <p className="text-sm text-red-900">
            Cancel {order.order_no}?
            {order.status === "pending_payment"
              ? " Its stock and slot will be released."
              : " Remember to refund the customer in Razorpay."}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run("cancel")}
              className="h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-60"
            >
              {pending ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmCancel(false)}
              className="h-12 rounded-xl bg-white font-semibold ring-1 ring-stone-300"
            >
              Keep order
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {order.status === "paid" && (
            <ActionButton pending={pending} onClick={() => run("ready")} className="bg-green-600 text-white">
              Mark Ready
            </ActionButton>
          )}
          {(order.status === "paid" || order.status === "ready") && (
            <ActionButton
              pending={pending}
              onClick={() => run("picked_up")}
              className={order.status === "ready" ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-300"}
            >
              Mark Picked up
            </ActionButton>
          )}
          {order.status === "ready" && (
            <SmallButton disabled={pending} onClick={() => run("undo_ready")}>
              Undo
            </SmallButton>
          )}
          {order.status === "picked_up" && (
            <SmallButton disabled={pending} onClick={() => run("undo_picked_up")}>
              Undo picked up
            </SmallButton>
          )}
          {canCancel && (
            <SmallButton disabled={pending} onClick={() => setConfirmCancel(true)} className="ml-auto text-red-600">
              Cancel
            </SmallButton>
          )}
        </div>
      )}
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  pending,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`h-12 flex-1 rounded-xl px-3 text-base font-bold disabled:opacity-60 ${className}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-stone-600 disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}
