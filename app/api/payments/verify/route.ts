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

export async function POST(req: Request) {
  const parsed = VerifyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid request." } }, { status: 400 });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  if (!isValidPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json(
      { error: { code: "BAD_SIGNATURE", message: "We could not verify this payment." } },
      { status: 400 },
    );
  }

  const result = await markOrderPaid({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id });
  if (!result.ok) {
    console.error("verify: markOrderPaid failed", result);
    const status = result.reason === "db_error" ? 500 : result.reason === "not_found" ? 404 : 409;
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase(), message: "We could not confirm this order." } },
      { status },
    );
  }

  return NextResponse.json({ ok: true, publicToken: result.publicToken });
}
