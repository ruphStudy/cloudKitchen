import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { KITCHEN, WHATSAPP_NUMBER } from "@/lib/config";
import { formatDayLong, formatInstantIST, formatPaise } from "@/lib/format";
import { orderWhatsAppMessage, waLink } from "@/lib/whatsapp";
import type { OrderStatus } from "@/lib/types";
import { PendingRefresher } from "@/components/PendingRefresher";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

interface OrderView {
  order_no: string;
  public_token: string;
  status: OrderStatus;
  customer_name: string;
  subtotal_paise: number;
  discount_paise: number;
  total_paise: number;
  razorpay_payment_id: string | null;
  refund_id: string | null;
  refund_amount_paise: number | null;
  refunded_at: string | null;
  coupons: { code: string } | null;
  service_days: { date: string } | null;
  slots: { label: string } | null;
  order_items: { name: string; quantity: number; line_total_paise: number }[];
}

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();

  const { data: order, error } = await getAdminClient()
    .from("orders")
    .select(
      "order_no,public_token,status,customer_name,subtotal_paise,discount_paise,total_paise,razorpay_payment_id,refund_id,refund_amount_paise,refunded_at,coupons(code),service_days(date),slots(label),order_items(name,quantity,line_total_paise)",
    )
    .eq("public_token", token)
    .maybeSingle<OrderView>();

  if (error) throw new Error(error.message);
  if (!order) notFound();

  const confirmed = order.status === "paid" || order.status === "ready" || order.status === "picked_up";
  const dayText = order.service_days ? formatDayLong(order.service_days.date) : "—";
  const slotText = order.slots?.label ?? "—";

  const whatsappHref =
    confirmed && WHATSAPP_NUMBER
      ? waLink(
          WHATSAPP_NUMBER,
          orderWhatsAppMessage({
            orderNo: order.order_no,
            name: order.customer_name,
            day: dayText,
            slot: slotText,
            items: order.order_items,
            totalPaise: order.total_paise,
          }),
        )
      : null;

  return (
    <main className="px-4 pb-28 pt-8">
      <div className="text-center">
        {confirmed ? (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-600 text-5xl text-white">
            ✓
          </div>
        ) : order.status === "pending_payment" ? (
          <span className="mx-auto block h-16 w-16 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
        ) : order.status === "refunded" ? (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-4xl text-white">
            ↩
          </div>
        ) : (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-stone-300 text-5xl text-white">
            ✕
          </div>
        )}

        <h1 className="mt-4 text-2xl font-bold">
          {confirmed && `Order ${order.order_no} confirmed`}
          {order.status === "pending_payment" && "Confirming your payment…"}
          {order.status === "cancelled" && `Order ${order.order_no} cancelled`}
          {order.status === "refunded" && `Order ${order.order_no} refunded`}
        </h1>
        {confirmed && <p className="mt-1 text-stone-600">Thank you, {order.customer_name}! See you soon.</p>}
        {order.status === "pending_payment" && (
          <>
            <p className="mt-1 text-stone-600">Order {order.order_no}. This usually takes a few seconds.</p>
            <PendingRefresher />
          </>
        )}
        {order.status === "cancelled" && order.razorpay_payment_id && (
          <p className="mx-auto mt-2 max-w-xs rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            We received your payment after this order was cancelled. We will refund it to you. Message us on
            WhatsApp if you have questions.
          </p>
        )}
        {order.status === "refunded" && (
          <div className="mx-auto mt-2 max-w-xs rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
            <p>
              We refunded {formatPaise(order.refund_amount_paise ?? order.total_paise)}
              {order.refunded_at && ` on ${formatInstantIST(order.refunded_at)}`}. It usually reaches your account
              in 5–7 working days.
            </p>
            {order.refund_id && <p className="mt-1 text-xs text-blue-700">Refund ID: {order.refund_id}</p>}
          </div>
        )}
        {order.status === "ready" && (
          <p className="mt-2 inline-block rounded-full bg-green-100 px-3 py-1 font-semibold text-green-800">
            Ready for pickup
          </p>
        )}
      </div>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex h-14 items-center justify-center rounded-2xl bg-[#1fa855] text-lg font-bold text-white active:opacity-90"
        >
          Send to WhatsApp
        </a>
      )}

      <section className="mt-6 space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <Row label="Pickup day" value={dayText} />
        <Row label="Pickup time" value={slotText} />
        <div>
          <p className="text-sm text-stone-500">Pickup address</p>
          <p className="text-base font-medium">{KITCHEN.pickupAddress}</p>
          <p className="mt-1 text-sm text-stone-500">{KITCHEN.pickupNote}</p>
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-base font-semibold">Items</h2>
        <ul className="mt-2 space-y-1">
          {order.order_items.map((it) => (
            <li key={it.name} className="flex justify-between gap-2">
              <span>
                {it.quantity} × {it.name}
              </span>
              <span className="shrink-0">{formatPaise(it.line_total_paise)}</span>
            </li>
          ))}
        </ul>
        {order.discount_paise > 0 && (
          <div className="mt-2 flex justify-between text-green-700">
            <span>Coupon{order.coupons ? ` ${order.coupons.code}` : ""}</span>
            <span>−{formatPaise(order.discount_paise)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-lg font-bold">
          <span>{confirmed ? "Paid" : "Total"}</span>
          <span>{formatPaise(order.total_paise)}</span>
        </div>
      </section>

      {confirmed && (
        <Link
          href={`/feedback/${order.public_token}`}
          className="mt-4 flex h-12 items-center justify-center rounded-xl bg-white font-semibold text-brand-700 ring-1 ring-stone-200"
        >
          Tried it? Tell us how it was ⭐
        </Link>
      )}

      <p className="mt-6 text-center text-sm text-stone-500">Save this page link to check your order later.</p>
      <div className="mt-4 text-center">
        <Link href="/" className="inline-block rounded-xl px-4 py-3 font-semibold text-brand-600">
          Back to menu
        </Link>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-stone-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
