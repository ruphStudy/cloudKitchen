import Link from "next/link";
import { listDays, listMenu, listOrders, listSlots, listStock, type AdminDay } from "@/lib/admin-data";
import { addDays, istDate } from "@/lib/order-window";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";

function pickDay(days: AdminDay[], requested: string | undefined, today: string): AdminDay | undefined {
  return (
    days.find((d) => d.id === requested) ??
    days.find((d) => d.date === today) ??
    days.find((d) => d.date > today) ??
    days.at(-1)
  );
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: requested } = await searchParams;
  const today = istDate();
  const days = await listDays(addDays(today, -14));
  const day = pickDay(days, requested, today);

  if (!day) {
    return (
      <main className="p-4">
        <p className="rounded-xl bg-white p-4">
          No service days yet.{" "}
          <Link href="/admin/settings" className="font-semibold text-brand-600">
            Add one in Settings
          </Link>
          .
        </p>
      </main>
    );
  }

  const [slots, stock, menu, orders] = await Promise.all([
    listSlots([day.id]),
    listStock([day.id]),
    listMenu(),
    listOrders([day.id]),
  ]);

  return (
    <AdminDashboard
      days={days.map((d) => ({ id: d.id, date: d.date, label: d.label }))}
      day={day}
      today={today}
      slots={slots}
      stock={stock}
      menu={menu}
      orders={orders}
      serverNow={Date.now()}
    />
  );
}
