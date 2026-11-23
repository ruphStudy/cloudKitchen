import { NextResponse } from "next/server";
import { isValidWebhookSignature } from "@/lib/razorpay";
import { markOrderPaid } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PaymentEntity {
  id: string;
  order_id: string | null;
  amount: number;
  status: string;
}

interface WebhookEvent {
  event: string;
  payload?: { payment?: { entity?: PaymentEntity } };
}

/**
 * Backup path if the customer closes the browser before /verify runs.
 * Subscribe to `payment.captured` (and optionally `order.paid`) in the Razorpay dashboard.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  if (!signature || !isValidWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    return NextResponse.json({ ok: true, ignored: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id) {
    return NextResponse.json({ ok: true, ignored: "no order_id" });
  }

  const result = await markOrderPaid({
    razorpayOrderId: payment.order_id,
    razorpayPaymentId: payment.id,
    amountPaise: payment.amount,
  });

  if (!result.ok) {
    console.error("webhook: markOrderPaid failed", { event: event.event, payment: payment.id, result });
    // 500 makes Razorpay retry (useful for transient DB errors). Other cases won't fix themselves.
    if (result.reason === "db_error") return NextResponse.json({ error: "db error" }, { status: 500 });
    return NextResponse.json({ ok: true, ignored: result.reason });
  }

  return NextResponse.json({ ok: true });
}
