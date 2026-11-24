import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { couponErrorMessage } from "@/lib/coupon-errors";
import { PHONE_REGEX } from "@/lib/cart";
import { MAX_QTY_PER_ITEM } from "@/lib/config";
import { ipBucket } from "@/lib/ip";
import { hitRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({
  code: z.string().trim().min(1).max(20),
  phone: z.string().regex(PHONE_REGEX).optional().or(z.literal("")),
  items: z
    .array(z.object({ menuItemId: z.uuid(), quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM) }))
    .min(1)
    .max(20),
});

function fail(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

/**
 * Preview a coupon for the current cart. Prices come from the DB. This is only a
 * preview: place_order checks the coupon again when the order is created.
 */
export async function POST(req: Request) {
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Please enter a coupon code.");
  const { code, phone, items } = parsed.data;

  try {
    if (!(await hitRateLimit(ipBucket("coupon:ip", req.headers), 30, 600))) {
      return fail(429, "Too many tries. Please wait a few minutes.");
    }
  } catch (err) {
    console.error(err);
    return fail(500, "Could not check the coupon. Try again.");
  }

  const db = getAdminClient();
  const ids = [...new Set(items.map((i) => i.menuItemId))];
  const { data: menu, error: menuErr } = await db
    .from("menu_items")
    .select("id,price_paise")
    .eq("is_active", true)
    .in("id", ids);
  if (menuErr) return fail(500, "Could not check the coupon. Try again.");
  const price = new Map((menu ?? []).map((m: { id: string; price_paise: number }) => [m.id, m.price_paise]));
  if (items.some((i) => !price.has(i.menuItemId))) return fail(409, "Something in your cart is no longer available.");
  const subtotal = items.reduce((sum, i) => sum + price.get(i.menuItemId)! * i.quantity, 0);

  const { data, error } = await db
    .rpc("evaluate_coupon", { p_code: code, p_subtotal: subtotal, p_phone: phone || null })
    .single<{ coupon_id: string; code: string; discount_paise: number }>();

  if (error || !data) {
    const msg = error && couponErrorMessage(error.message, error.details);
    if (msg) return fail(409, msg);
    console.error("evaluate_coupon failed", error);
    return fail(500, "Could not check the coupon. Try again.");
  }

  return NextResponse.json({
    code: data.code,
    subtotalPaise: subtotal,
    discountPaise: data.discount_paise,
    totalPaise: subtotal - data.discount_paise,
  });
}
