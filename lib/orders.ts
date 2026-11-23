import "server-only";
import { getAdminClient } from "@/lib/supabase/server";

export type MarkPaidResult =
  | { ok: true; publicToken: string; alreadyPaid: boolean }
  | { ok: false; reason: "not_found" | "amount_mismatch" | "not_payable" | "db_error"; message?: string };

/**
 * Idempotently mark the order for a Razorpay order id as paid.
 * Safe to call from both /verify and the webhook, in any order, any number of times.
 */
export async function markOrderPaid(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise?: number;
}): Promise<MarkPaidResult> {
  const db = getAdminClient();

  const { data: order, error } = await db
    .from("orders")
    .select("id,status,total_paise,public_token")
    .eq("razorpay_order_id", params.razorpayOrderId)
    .maybeSingle<{ id: string; status: string; total_paise: number; public_token: string }>();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!order) return { ok: false, reason: "not_found" };
  if (params.amountPaise !== undefined && params.amountPaise !== order.total_paise) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (order.status === "cancelled") {
    // Admin cancelled a stuck order but the customer paid anyway. Keep it cancelled (stock was
    // released) but record the payment so the admin sees "Refund needed".
    await db
      .from("orders")
      .update({ razorpay_payment_id: params.razorpayPaymentId, paid_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("razorpay_payment_id", null);
    return { ok: false, reason: "not_payable" };
  }
  if (order.status !== "pending_payment") {
    return { ok: true, publicToken: order.public_token, alreadyPaid: true };
  }

  // Conditional update: only one caller wins the transition; others see 0 rows.
  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({
      status: "paid",
      razorpay_payment_id: params.razorpayPaymentId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("id");

  if (updateError) return { ok: false, reason: "db_error", message: updateError.message };
  return { ok: true, publicToken: order.public_token, alreadyPaid: (updated ?? []).length === 0 };
}
