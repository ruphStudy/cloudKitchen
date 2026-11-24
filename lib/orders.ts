import "server-only";
import { getAdminClient } from "@/lib/supabase/server";

export type MarkPaidOutcome =
  | "paid"
  | "already_paid"
  | "paid_after_cancel"
  | "not_payable"
  | "amount_mismatch"
  | "not_found";

export type MarkPaidResult =
  | { ok: true; outcome: MarkPaidOutcome; publicToken: string | null }
  | { ok: false; reason: "db_error"; message: string };

/**
 * The single idempotent "payment captured" update (SQL: mark_order_paid). Used by both
 * /api/payments/verify and the webhook, in any order, any number of times. It moves
 * pending_payment → paid and increments the coupon's used_count exactly once.
 */
export async function markOrderPaid(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise?: number;
}): Promise<MarkPaidResult> {
  const { data, error } = await getAdminClient()
    .rpc("mark_order_paid", {
      p_razorpay_order_id: params.razorpayOrderId,
      p_payment_id: params.razorpayPaymentId,
      p_amount_paise: params.amountPaise ?? null,
    })
    .single<{ result: MarkPaidOutcome; public_token: string | null }>();

  if (error || !data) return { ok: false, reason: "db_error", message: error?.message ?? "no result" };
  return { ok: true, outcome: data.result, publicToken: data.public_token };
}
