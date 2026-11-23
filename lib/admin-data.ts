import "server-only";
import { getAdminClient } from "@/lib/supabase/server";
import type { Category, OrderStatus } from "@/lib/types";

// Admin reads use the service-role client. Callers must have passed the admin check
// (the /admin layout or requireAdmin()).

export interface AdminDay {
  id: string;
  date: string;
  label: string | null;
  is_enabled: boolean;
  is_tasting_day: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

export interface AdminSlot {
  id: string;
  service_day_id: string;
  label: string;
  start_time: string;
  end_time: string;
  capacity: number;
  is_enabled: boolean;
}

export interface AdminStock {
  id: string;
  service_day_id: string;
  category: Category;
  stock_limit: number;
}

export interface AdminMenuItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: Category;
  price_paise: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface AdminOrder {
  id: string;
  service_day_id: string;
  order_no: string;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  total_paise: number;
  slot_id: string;
  created_at: string;
  paid_at: string | null;
  razorpay_payment_id: string | null;
  items: { menu_item_id: string; name: string; category: string; quantity: number }[];
}

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

export async function listDays(fromDate: string): Promise<AdminDay[]> {
  const res = await getAdminClient()
    .from("service_days")
    .select("id,date,label,is_enabled,is_tasting_day,opens_at,closes_at")
    .gte("date", fromDate)
    .order("date");
  return check<AdminDay[]>(res, "Load days");
}

export async function listSlots(dayIds: string[]): Promise<AdminSlot[]> {
  if (dayIds.length === 0) return [];
  const res = await getAdminClient()
    .from("slots")
    .select("id,service_day_id,label,start_time,end_time,capacity,is_enabled")
    .in("service_day_id", dayIds)
    .order("start_time");
  return check<AdminSlot[]>(res, "Load slots");
}

export async function listStock(dayIds: string[]): Promise<AdminStock[]> {
  if (dayIds.length === 0) return [];
  const res = await getAdminClient()
    .from("day_stock")
    .select("id,service_day_id,category,stock_limit")
    .in("service_day_id", dayIds);
  return check<AdminStock[]>(res, "Load stock");
}

export async function listMenu(): Promise<AdminMenuItem[]> {
  const res = await getAdminClient()
    .from("menu_items")
    .select("id,slug,name,description,category,price_paise,image_url,is_active,sort_order")
    .order("sort_order")
    .order("name");
  return check<AdminMenuItem[]>(res, "Load menu");
}

export async function listOrders(dayIds: string[]): Promise<AdminOrder[]> {
  if (dayIds.length === 0) return [];
  const res = await getAdminClient()
    .from("orders")
    .select(
      "id,service_day_id,order_no,status,customer_name,customer_phone,total_paise,slot_id,created_at,paid_at,razorpay_payment_id,items:order_items(menu_item_id,name,category,quantity)",
    )
    .in("service_day_id", dayIds)
    .order("created_at");
  return check<AdminOrder[]>(res, "Load orders");
}
