import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidPaymentSignature } from "@/lib/razorpay";
import { markOrderPaid } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VerifyInput = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
});

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  const parsed = VerifyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "INVALID_INPUT", "Invalid request.");
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  if (!isValidPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return fail(400, "BAD_SIGNATURE", "We could not verify this payment.");
  }

  const result = await markOrderPaid({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id });
  if (!result.ok) {
    console.error("verify: mark_order_paid failed", result);
    return fail(500, "DB_ERROR", "We could not confirm this order yet.");
  }

  switch (result.outcome) {
    case "paid":
    case "already_paid":
    case "paid_after_cancel": // order page explains the refund
      return NextResponse.json({ ok: true, outcome: result.outcome, publicToken: result.publicToken });
    case "not_found":
      return fail(404, "NOT_FOUND", "We could not find this order.");
    default:
      console.error("verify: unexpected outcome", result.outcome, razorpay_order_id);
      return fail(409, result.outcome.toUpperCase(), "We could not confirm this order.");
  }
}
