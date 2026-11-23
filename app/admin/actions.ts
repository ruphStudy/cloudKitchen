"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import { getAdminClient } from "@/lib/supabase/server";
import { getAuthClient } from "@/lib/supabase/auth";
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

export async function signOut(): Promise<void> {
  const supabase = await getAuthClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
