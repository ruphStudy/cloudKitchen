"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getAdminClient } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/money";
import { istInputToIso } from "@/lib/order-window";

export interface FormState {
  ok?: boolean;
  message?: string;
}

const fail = (message: string): FormState => ({ ok: false, message });
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

export async function createCoupon(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await requireAdmin();
  } catch {
    return fail("Not allowed.");
  }

  const code = str(fd, "code").toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return fail("Code: 3–20 letters/numbers, no spaces.");

  const kind = z.enum(["flat", "percent"]).safeParse(str(fd, "kind"));
  if (!kind.success) return fail("Pick flat or percent.");

  let value: number | null;
  if (kind.data === "flat") {
    value = rupeesToPaise(str(fd, "value"));
    if (!value || value <= 0) return fail("Enter the discount in rupees, like 20.");
  } else {
    value = Number(str(fd, "value"));
    if (!Number.isInteger(value) || value < 1 || value > 100) return fail("Percent must be a whole number 1–100.");
  }

  const minOrder = str(fd, "min_order") ? rupeesToPaise(str(fd, "min_order")) : 0;
  if (minOrder === null) return fail("Minimum order must be in rupees, like 100.");

  const maxUsesRaw = str(fd, "max_uses");
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return fail("Max uses must be 1 or more.");

  const validFrom = istInputToIso(str(fd, "valid_from"));
  const validUntil = istInputToIso(str(fd, "valid_until"));
  if (validFrom === undefined || validUntil === undefined) return fail("Check the dates.");
  if (validFrom && validUntil && Date.parse(validFrom) >= Date.parse(validUntil)) {
    return fail("'Valid from' must be before 'valid until'.");
  }

  const { error } = await getAdminClient().from("coupons").insert({
    code,
    kind: kind.data,
    value,
    min_order_paise: minOrder,
    max_uses: maxUses,
    valid_from: validFrom,
    valid_until: validUntil,
    is_active: true,
  });
  if (error?.code === "23505") return fail("That code already exists.");
  if (error) return fail(`Could not save: ${error.message}`);
  revalidatePath("/admin/coupons");
  return { ok: true, message: `Coupon ${code} created.` };
}

export async function setCouponActive(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await requireAdmin();
  } catch {
    return fail("Not allowed.");
  }
  const id = z.uuid().safeParse(str(fd, "id"));
  if (!id.success) return fail("Invalid coupon.");
  const active = str(fd, "active") === "true";
  const { error } = await getAdminClient().from("coupons").update({ is_active: active }).eq("id", id.data);
  if (error) return fail(`Could not save: ${error.message}`);
  revalidatePath("/admin/coupons");
  return { ok: true, message: active ? "Enabled." : "Disabled." };
}
