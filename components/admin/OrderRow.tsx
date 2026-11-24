"use client";

import { useState, useTransition } from "react";
import {
  markRefundedManually,
  refundOrder,
  setOrderStatus,
  type StatusAction,
} from "@/app/admin/actions";
import type { AdminOrder } from "@/lib/admin-data";
import { isConfirmed, isStalePending } from "@/lib/availability";
import { formatPaise } from "@/lib/format";
import { feedbackRequestMessage, waLink } from "@/lib/whatsapp";

function Badge({ order, now }: { order: AdminOrder; now: number }) {
  const map: Record<string, [string, string]> = {
    paid: ["Paid", "bg-blue-100 text-blue-800"],
    ready: ["Ready", "bg-green-100 text-green-800"],
    picked_up: ["Picked up", "bg-stone-200 text-stone-700"],
    cancelled: ["Cancelled", "bg-red-100 text-red-800"],
    refunded: ["Refunded", "bg-purple-100 text-purple-800"],
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

type Confirming = null | "cancel" | "refund";

export function OrderRow({ order, now, siteUrl }: { order: AdminOrder; now: number; siteUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  function run(action: StatusAction) {
    setError(null);
    startTransition(async () => {
      const res = await setOrderStatus(order.id, action);
      if (!res.ok) setError(res.message ?? "Something went wrong.");
      setConfirming(null);
    });
  }

  function refund(manual: boolean) {
    setError(null);
    startTransition(async () => {
      const res = manual ? await markRefundedManually(order.id) : await refundOrder(order.id);
      if (!res.ok) {
        setError(res.message ?? "Refund failed.");
        if (res.canMarkManually) setShowManual(true);
      } else {
        setShowManual(false);
      }
      setConfirming(null);
    });
  }

  const refundNeeded = order.status === "cancelled" && !!order.razorpay_payment_id;
  const canCancel = order.status === "pending_payment" || order.status === "paid" || order.status === "ready";
  const dim = order.status === "picked_up" || order.status === "cancelled" || order.status === "refunded";
  const feedbackHref = isConfirmed(order.status)
    ? waLink(
        `91${order.customer_phone}`,
        feedbackRequestMessage(order.customer_name, order.order_no, `${siteUrl}/feedback/${order.public_token}`),
      )
    : null;

  return (
    <li className={`rounded-2xl bg-white p-3 ring-1 ring-stone-200 ${dim && !refundNeeded ? "opacity-70" : ""}`}>
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
        <div className="shrink-0 text-right">
          <span className="text-lg font-bold tabular-nums">{formatPaise(order.total_paise)}</span>
          {order.discount_paise > 0 && (
            <span className="block text-xs text-green-700">
              −{formatPaise(order.discount_paise)} {order.coupon?.code}
            </span>
          )}
        </div>
      </div>

      <p className="mt-1 text-base">
        {order.items.map((it, i) => (
          <span key={it.menu_item_id}>
            {i > 0 && ", "}
            <b>{it.quantity}×</b> {it.name.replace(/ bowl$/i, "")}
          </span>
        ))}
      </p>

      {order.status === "refunded" && (
        <p className="mt-1 text-xs text-purple-800">
          {order.refund_id ? `Refund ID ${order.refund_id}` : (order.refund_note ?? "Refunded")}
        </p>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {confirming === "cancel" && (
        <ConfirmBox
          text={`Cancel ${order.order_no}?${
            order.status === "pending_payment"
              ? " Its stock and slot will be released."
              : " You'll then need to refund it (Refund button)."
          }`}
          yes="Yes, cancel"
          pending={pending}
          onYes={() => run("cancel")}
          onNo={() => setConfirming(null)}
        />
      )}

      {confirming === "refund" && (
        <ConfirmBox
          text={`Refund ${formatPaise(order.total_paise)} to ${order.customer_name} through Razorpay?`}
          yes="Yes, refund"
          pending={pending}
          onYes={() => refund(false)}
          onNo={() => setConfirming(null)}
        />
      )}

      {confirming === null && (
        <div className="mt-3 flex flex-wrap gap-2">
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
          {refundNeeded && (
            <ActionButton pending={pending} onClick={() => setConfirming("refund")} className="bg-red-600 text-white">
              Refund {formatPaise(order.total_paise)}
            </ActionButton>
          )}
          {refundNeeded && showManual && (
            <ActionButton pending={pending} onClick={() => refund(true)} className="bg-white ring-1 ring-stone-300">
              Mark refunded manually
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
          {feedbackHref && order.status === "picked_up" && (
            <a
              href={feedbackHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center rounded-xl px-3 text-sm font-semibold text-[#128c4a]"
            >
              Ask feedback
            </a>
          )}
          {canCancel && (
            <SmallButton disabled={pending} onClick={() => setConfirming("cancel")} className="ml-auto text-red-600">
              Cancel
            </SmallButton>
          )}
          {refundNeeded && !showManual && (
            <SmallButton disabled={pending} onClick={() => setShowManual(true)} className="ml-auto">
              Refunded elsewhere?
            </SmallButton>
          )}
        </div>
      )}
    </li>
  );
}

function ConfirmBox(props: { text: string; yes: string; pending: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="mt-3 rounded-xl bg-red-50 p-3">
      <p className="text-sm text-red-900">{props.text}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={props.pending}
          onClick={props.onYes}
          className="h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-60"
        >
          {props.pending ? "Working…" : props.yes}
        </button>
        <button
          type="button"
          disabled={props.pending}
          onClick={props.onNo}
          className="h-12 rounded-xl bg-white font-semibold ring-1 ring-stone-300"
        >
          Go back
        </button>
      </div>
    </div>
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
      className={`h-12 min-w-[40%] flex-1 rounded-xl px-3 text-base font-bold disabled:opacity-60 ${className}`}
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
