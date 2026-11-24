"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import { getAdminClient } from "@/lib/supabase/server";
import { getAuthClient } from "@/lib/supabase/auth";
import { getRazorpay } from "@/lib/razorpay";
import type { OrderStatus } from "@/lib/types";

export type StatusAction = "ready" | "picked_up" | "cancel" | "undo_ready" | "undo_picked_up";

/**
 * Allowed transitions. Only paid orders move forward (paid → ready → picked_up), so admin
 * actions never touch pending_payment → paid; that stays with verify/webhook.
 */
const TRANSITIONS: Record<StatusAction, { from: OrderStatus[]; to: OrderStatus }> = {
  ready: { from: ["paid"], to: "ready" },
  picked_up: { from: ["paid", "ready"], to: "picked_up" },
  undo_ready: { from: ["ready"], to: "paid" },
  undo_picked_up: { from: ["picked_up"], to: "ready" },
  // Cancelling a pending order releases its stock immediately.
  cancel: { from: ["pending_payment", "paid", "ready"], to: "cancelled" },
};

export interface ActionResult {
  ok: boolean;
  message?: string;
}

const Input = z.object({
  orderId: z.uuid(),
  action: z.enum(["ready", "picked_up", "cancel", "undo_ready", "undo_picked_up"]),
});

export async function setOrderStatus(orderId: string, action: StatusAction): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) return { ok: false, message: "Not allowed." };
    throw e;
  }

  const parsed = Input.safeParse({ orderId, action });
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const t = TRANSITIONS[parsed.data.action];
  // Conditional update: only applies if the order is still in an allowed state.
  const { data, error } = await getAdminClient()
    .from("orders")
    .update({ status: t.to })
    .eq("id", parsed.data.orderId)
    .in("status", t.from)
    .select("id");

  if (error) {
    console.error("setOrderStatus failed", error);
    return { ok: false, message: "Could not update. Try again." };
  }
  revalidatePath("/admin");
  if (!data || data.length === 0) {
    return { ok: false, message: "This order changed meanwhile. The list has been refreshed." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Refunds (only for cancelled orders that have a payment: "Refund needed")
// ---------------------------------------------------------------------------

export interface RefundResult extends ActionResult {
  /** True when the API call failed and the admin may mark it refunded by hand. */
  canMarkManually?: boolean;
}

interface RefundableOrder {
  id: string;
  order_no: string;
  status: OrderStatus;
  razorpay_payment_id: string | null;
  total_paise: number;
  refund_id: string | null;
}

async function loadRefundable(orderId: string): Promise<RefundableOrder | string> {
  if (!z.uuid().safeParse(orderId).success) return "Invalid request.";
  const { data, error } = await getAdminClient()
    .from("orders")
    .select("id,order_no,status,razorpay_payment_id,total_paise,refund_id")
    .eq("id", orderId)
    .maybeSingle<RefundableOrder>();
  if (error) return "Could not load the order.";
  if (!data) return "Order not found.";
  if (data.status === "refunded") return "Already refunded.";
  if (data.status !== "cancelled" || !data.razorpay_payment_id) {
    return "Only cancelled orders with a payment can be refunded.";
  }
  return data;
}

function razorpayErrorText(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const e = (err as { error?: { description?: string; code?: string } }).error;
    if (e?.description) return e.description;
    if (e?.code) return e.code;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

/** Full refund through the Razorpay API, then status → refunded with the refund id. */
export async function refundOrder(orderId: string): Promise<RefundResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, message: "Not allowed." };
  }
  const order = await loadRefundable(orderId);
  if (typeof order === "string") return { ok: false, message: order };

  const db = getAdminClient();
  // Claim the refund so a double tap can't refund twice (the claim expires after 2 minutes).
  const staleClaim = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("orders")
    .update({ refund_requested_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "cancelled")
    .is("refund_id", null)
    .or(`refund_requested_at.is.null,refund_requested_at.lt.${staleClaim}`)
    .select("id");
  if (claimErr) return { ok: false, message: "Could not start the refund. Try again." };
  if (!claimed || claimed.length === 0) {
    return { ok: false, message: "A refund for this order is already in progress. Refresh in a minute." };
  }

  try {
    const refund = await getRazorpay().payments.refund(order.razorpay_payment_id!, {
      amount: order.total_paise,
      speed: "normal",
      receipt: order.order_no,
      notes: { order_no: order.order_no },
    });
    const { error } = await db
      .from("orders")
      .update({
        status: "refunded",
        refund_id: refund.id,
        refund_amount_paise: typeof refund.amount === "number" ? refund.amount : order.total_paise,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    if (error) {
      console.error("refund saved at Razorpay but DB update failed", { order: order.order_no, refund: refund.id, error });
      return {
        ok: false,
        message: `Refunded at Razorpay (${refund.id}) but saving failed. Use "Mark refunded manually".`,
        canMarkManually: true,
      };
    }
    revalidatePath("/admin");
    return { ok: true, message: `Refunded. Refund ID ${refund.id}` };
  } catch (err) {
    console.error("Razorpay refund failed", { order: order.order_no, err });
    await db.from("orders").update({ refund_requested_at: null }).eq("id", order.id).is("refund_id", null);
    return { ok: false, message: `Refund failed: ${razorpayErrorText(err)}`, canMarkManually: true };
  }
}

/** For refunds done outside the app (Razorpay dashboard, UPI, cash). */
export async function markRefundedManually(orderId: string): Promise<RefundResult> {
  let email: string;
  try {
    email = await requireAdmin();
  } catch {
    return { ok: false, message: "Not allowed." };
  }
  const order = await loadRefundable(orderId);
  if (typeof order === "string") return { ok: false, message: order };

  const { data, error } = await getAdminClient()
    .from("orders")
    .update({
      status: "refunded",
      refund_amount_paise: order.total_paise,
      refunded_at: new Date().toISOString(),
      refund_note: `Marked refunded manually by ${email}`,
    })
    .eq("id", order.id)
    .eq("status", "cancelled")
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Could not update. Refresh and try again." };
  revalidatePath("/admin");
  return { ok: true, message: "Marked as refunded." };
}

export async function signOut(): Promise<void> {
  const supabase = await getAuthClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
