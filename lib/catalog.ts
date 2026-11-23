import "server-only";
import { getAdminClient, getPublicClient } from "@/lib/supabase/server";
import { istDate, isDayOpen, nextOpening } from "@/lib/order-window";
import type { Catalog, CatalogDay, Category, MenuItem } from "@/lib/types";

interface DayRow {
  id: string;
  date: string;
  label: string | null;
  is_tasting_day: boolean;
  opens_at: string | null;
  closes_at: string | null;
}
interface SlotRow {
  id: string;
  service_day_id: string;
  label: string;
  capacity: number;
}
interface StockRow {
  service_day_id: string;
  category: Category;
  stock_limit: number;
}
interface Usage {
  slots: Record<string, number>;
  stock: { service_day_id: string; category: Category; used: number }[];
}

/** Menu + open days with live remaining capacity and stock. */
export async function getCatalog(): Promise<Catalog> {
  const pub = getPublicClient();
  const admin = getAdminClient();
  const now = Date.now();

  const [itemsRes, daysRes, slotsRes, stockRes, usageRes] = await Promise.all([
    pub
      .from("menu_items")
      .select("id,name,description,category,price_paise,image_url")
      .eq("is_active", true)
      .order("sort_order"),
    // RLS already limits anon to enabled days.
    pub
      .from("service_days")
      .select("id,date,label,is_tasting_day,opens_at,closes_at")
      .gte("date", istDate(now))
      .order("date"),
    pub.from("slots").select("id,service_day_id,label,capacity").eq("is_enabled", true).order("start_time"),
    pub.from("day_stock").select("service_day_id,category,stock_limit"),
    admin.rpc("get_availability"),
  ]);

  for (const res of [itemsRes, daysRes, slotsRes, stockRes, usageRes]) {
    if (res.error) throw new Error(`Catalog load failed: ${res.error.message}`);
  }

  const items = (itemsRes.data ?? []) as MenuItem[];
  const dayRows = (daysRes.data ?? []) as DayRow[];
  const slotRows = (slotsRes.data ?? []) as SlotRow[];
  const stockRows = (stockRes.data ?? []) as StockRow[];
  const usage = (usageRes.data ?? { slots: {}, stock: [] }) as Usage;

  const days: CatalogDay[] = dayRows
    .filter((d) => isDayOpen(d, now))
    .map((d) => {
      const slots = slotRows
        .filter((s) => s.service_day_id === d.id)
        .map((s) => ({ id: s.id, label: s.label, remaining: s.capacity - (usage.slots[s.id] ?? 0) }))
        .filter((s) => s.remaining > 0);

      const stockRemaining: CatalogDay["stockRemaining"] = {};
      for (const row of stockRows) {
        if (row.service_day_id !== d.id) continue;
        const used =
          usage.stock.find((u) => u.service_day_id === d.id && u.category === row.category)?.used ?? 0;
        stockRemaining[row.category] = Math.max(0, row.stock_limit - used);
      }
      return { id: d.id, date: d.date, label: d.label, isTastingDay: d.is_tasting_day, slots, stockRemaining };
    });

  return { items, days, nextOpensAt: nextOpening(dayRows, now) };
}

/** Highest number of bowls of a category still orderable on any open day. */
export function maxAvailableByCategory(days: CatalogDay[]): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const day of days) {
    if (day.slots.length === 0) continue;
    for (const [cat, left] of Object.entries(day.stockRemaining) as [Category, number][]) {
      out[cat] = Math.max(out[cat] ?? 0, left);
    }
  }
  return out;
}
