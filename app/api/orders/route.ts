import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { getRazorpay } from "@/lib/razorpay";
import { PHONE_REGEX } from "@/lib/cart";
import { MAX_QTY_PER_ITEM, ORDER_RATE_LIMIT } from "@/lib/config";
import { couponErrorMessage } from "@/lib/coupon-errors";
import { ipBucket } from "@/lib/ip";
import { hitRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OrderInput = z.object({
  serviceDayId: z.uuid(),
  slotId: z.uuid(),
  name: z.string().trim().min(2, "Please enter your name").max(60),
  phone: z.string().regex(PHONE_REGEX, "Enter a valid 10-digit mobile number"),
  fulfilment: z.literal("pickup").default("pickup"),
  items: z
    .array(z.object({ menuItemId: z.uuid(), quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM) }))
    .min(1, "Your cart is empty")
    .max(20),
  couponCode: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
});

const DB_ERRORS: Record<string, { status: number; message: string }> = {
  DAY_CLOSED: { status: 409, message: "Orders for this day are closed. Please pick another day." },
  SLOT_INVALID: { status: 409, message: "That pickup slot is no longer available. Please pick another." },
  SLOT_FULL: { status: 409, message: "That slot just filled up. Please pick another slot." },
  ITEM_INVALID: { status: 409, message: "Something in your cart is no longer available. Please check the menu." },
  SOLD_OUT: { status: 409, message: "Sorry, some dishes just sold out for this day. Please reduce quantity or pick another day." },
  TOO_MANY_PENDING: {
    status: 429,
    message: "You already have 2 unpaid orders. Please finish paying for one, or wait 10 minutes and try again.",
  },
  TASTING_ONE_ITEM: {
    status: 409,
    message: "Tasting day: 1 bowl per person. Please keep just one item in your cart.",
  },
  TASTING_ALREADY_BOOKED: { status: 409, message: "You've already booked your taste bowl!" },
};

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "BAD_JSON", "Invalid request.");
  }

  const parsed = OrderInput.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;

  // Merge duplicate lines.
  const qty = new Map<string, number>();
  for (const line of input.items) qty.set(line.menuItemId, (qty.get(line.menuItemId) ?? 0) + line.quantity);
  if ([...qty.values()].some((q) => q > MAX_QTY_PER_ITEM)) {
    return jsonError(400, "INVALID_INPUT", `Max ${MAX_QTY_PER_ITEM} of one dish per order.`);
  }

  const db = getAdminClient();

  // Per-IP limit. Only a hash of the IP is stored.
  try {
    const allowed = await hitRateLimit(
      ipBucket("orders:ip", req.headers),
      ORDER_RATE_LIMIT.perIp,
      ORDER_RATE_LIMIT.windowSeconds,
    );
    if (!allowed) return jsonError(429, "RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  } catch (err) {
    console.error(err);
    return jsonError(500, "SERVER_ERROR", "Could not place your order. Please try again.");
  }

  // Validates day/slot/stock and inserts order + items atomically. Prices come from the DB.
  const { data, error } = await db
    .rpc("place_order", {
      p_service_day_id: input.serviceDayId,
      p_slot_id: input.slotId,
      p_customer_name: input.name,
      p_customer_phone: input.phone,
      p_fulfilment: input.fulfilment,
      p_items: [...qty].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })),
      p_coupon_code: input.couponCode ?? null,
    })
    .single<{ order_id: string; order_no: string; public_token: string; total_paise: number }>();

  if (error || !data) {
    const known = error && DB_ERRORS[error.message];
    if (known) return jsonError(known.status, error.message, known.message);
    const couponMsg = error && couponErrorMessage(error.message, error.details);
    if (couponMsg) return jsonError(409, error!.message, couponMsg);
    console.error("place_order failed", error);
    return jsonError(500, "SERVER_ERROR", "Could not place your order. Please try again.");
  }

  try {
    const rzpOrder = await getRazorpay().orders.create({
      amount: data.total_paise,
      currency: "INR",
      receipt: data.order_no,
      notes: { order_id: data.order_id, order_no: data.order_no },
    });

    const { error: updateError } = await db
      .from("orders")
      .update({ razorpay_order_id: rzpOrder.id })
      .eq("id", data.order_id);
    if (updateError) throw updateError;

    return NextResponse.json({
      orderId: data.order_id,
      orderNo: data.order_no,
      publicToken: data.public_token,
      razorpayOrderId: rzpOrder.id,
      amount: data.total_paise,
      currency: "INR",
    });
  } catch (err) {
    console.error("Razorpay order creation failed", err);
    // Release the held slot/stock straight away.
    await db.from("orders").update({ status: "cancelled" }).eq("id", data.order_id).eq("status", "pending_payment");
    return jsonError(502, "PAYMENT_INIT_FAILED", "Could not start the payment. Please try again.");
  }
}
