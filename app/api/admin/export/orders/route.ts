import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin";
import { listOrders, listSlots } from "@/lib/admin-data";
import { getAdminClient } from "@/lib/supabase/server";
import { csvResponse, paiseToRupees, toCsv } from "@/lib/csv";
import { formatInstantIST } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/export/orders?day=<service_day_id> */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (session.kind !== "admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const dayId = z.uuid().safeParse(req.nextUrl.searchParams.get("day"));
  if (!dayId.success) return NextResponse.json({ error: "Pass ?day=<id>" }, { status: 400 });

  const { data: day } = await getAdminClient()
    .from("service_days")
    .select("date")
    .eq("id", dayId.data)
    .maybeSingle<{ date: string }>();
  if (!day) return NextResponse.json({ error: "Day not found" }, { status: 404 });

  const [orders, slots] = await Promise.all([listOrders([dayId.data]), listSlots([dayId.data])]);
  const slotLabel = new Map(slots.map((s) => [s.id, s.label]));
  const slotOrder = new Map(slots.map((s, i) => [s.id, i]));
  orders.sort(
    (a, b) => (slotOrder.get(a.slot_id) ?? 99) - (slotOrder.get(b.slot_id) ?? 99) || a.created_at.localeCompare(b.created_at),
  );

  const csv = toCsv(
    [
      "Order no", "Day", "Slot", "Status", "Name", "Phone", "Items",
      "Subtotal (₹)", "Discount (₹)", "Coupon", "Total (₹)",
      "Placed at (IST)", "Paid at (IST)", "Payment ID", "Refund ID",
    ],
    orders.map((o) => [
      o.order_no,
      day.date,
      slotLabel.get(o.slot_id) ?? "",
      o.status,
      o.customer_name,
      o.customer_phone,
      o.items.map((i) => `${i.quantity} x ${i.name}`).join("; "),
      paiseToRupees(o.subtotal_paise),
      paiseToRupees(o.discount_paise),
      o.coupon?.code ?? "",
      paiseToRupees(o.total_paise),
      formatInstantIST(o.created_at),
      o.paid_at ? formatInstantIST(o.paid_at) : "",
      o.razorpay_payment_id ?? "",
      o.refund_id ?? "",
    ]),
  );
  return csvResponse(`orders-${day.date}.csv`, csv);
}
