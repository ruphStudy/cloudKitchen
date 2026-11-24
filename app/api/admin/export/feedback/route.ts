import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { listFeedback } from "@/lib/admin-data";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatInstantIST } from "@/lib/format";
import { istDate } from "@/lib/order-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (session.kind !== "admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const feedback = await listFeedback(10000);
  const csv = toCsv(
    ["Submitted (IST)", "Order no", "Service day", "Name", "Phone", "Dishes", "Taste (1-5)", "Spice", "Quantity", "Comment"],
    feedback.map((f) => [
      formatInstantIST(f.created_at),
      f.order?.order_no ?? "",
      f.order?.service_days?.date ?? "",
      f.order?.customer_name ?? "",
      f.order?.customer_phone ?? "",
      f.order?.items.map((i) => `${i.quantity} x ${i.name}`).join("; ") ?? "",
      f.rating,
      f.spice ?? "",
      f.quantity_feel ?? "",
      f.comment ?? "",
    ]),
  );
  return csvResponse(`feedback-${istDate()}.csv`, csv);
}
