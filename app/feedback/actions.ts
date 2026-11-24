"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { normalizePhoneInput, PHONE_REGEX } from "@/lib/cart";
import { normalizeOrderNo } from "@/lib/feedback";
import { ipBucket } from "@/lib/ip";
import { hitRateLimit } from "@/lib/rate-limit";

export interface FeedbackState {
  ok?: boolean;
  message?: string;
}

const CONFIRMED = ["paid", "ready", "picked_up"];

const FeedbackInput = z.object({
  token: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  spice: z.enum(["less", "right", "more"]).optional(),
  quantity_feel: z.enum(["less", "right", "more"]).optional(),
  comment: z.string().trim().max(1000).optional(),
});

/** One submit per order (unique order_id). Looked up by public_token only. */
export async function submitFeedback(_prev: FeedbackState, fd: FormData): Promise<FeedbackState> {
  const parsed = FeedbackInput.safeParse({
    token: fd.get("token"),
    rating: fd.get("rating"),
    spice: fd.get("spice") || undefined,
    quantity_feel: fd.get("quantity_feel") || undefined,
    comment: fd.get("comment") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Please pick how it tasted (1 to 5)." };
  const input = parsed.data;

  const db = getAdminClient();
  const { data: order, error } = await db
    .from("orders")
    .select("id,status")
    .eq("public_token", input.token)
    .maybeSingle<{ id: string; status: string }>();
  if (error) return { ok: false, message: "Something went wrong. Please try again." };
  if (!order || !CONFIRMED.includes(order.status)) return { ok: false, message: "We couldn't find this order." };

  const { error: insertErr } = await db.from("feedback").insert({
    order_id: order.id,
    rating: input.rating,
    spice: input.spice ?? null,
    quantity_feel: input.quantity_feel ?? null,
    comment: input.comment || null,
  });
  if (insertErr?.code === "23505") return { ok: true, message: "already" };
  if (insertErr) {
    console.error("feedback insert failed", insertErr);
    return { ok: false, message: "Could not save. Please try again." };
  }
  return { ok: true };
}

/** /feedback (QR code on bowls): order number + mobile → /feedback/<public_token>. */
export async function findOrderForFeedback(_prev: FeedbackState, fd: FormData): Promise<FeedbackState> {
  const orderNo = normalizeOrderNo(String(fd.get("order_no") ?? ""));
  const phone = normalizePhoneInput(String(fd.get("phone") ?? ""));
  if (!orderNo) return { ok: false, message: "Enter the order number from your bowl, like K-1001." };
  if (!PHONE_REGEX.test(phone)) return { ok: false, message: "Enter the 10-digit mobile number you ordered with." };

  try {
    if (!(await hitRateLimit(ipBucket("feedback-lookup:ip", await headers()), 20, 600))) {
      return { ok: false, message: "Too many tries. Please wait a few minutes." };
    }
  } catch (err) {
    console.error(err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  const { data } = await getAdminClient()
    .from("orders")
    .select("public_token,status")
    .eq("order_no", orderNo)
    .eq("customer_phone", phone)
    .maybeSingle<{ public_token: string; status: string }>();

  if (!data || !CONFIRMED.includes(data.status)) {
    return { ok: false, message: "We couldn't find that order. Check the number on your bowl and your mobile." };
  }
  redirect(`/feedback/${data.public_token}`);
}
