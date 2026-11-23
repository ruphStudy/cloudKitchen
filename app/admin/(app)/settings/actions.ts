"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getAdminClient } from "@/lib/supabase/server";
import { CATEGORIES, DEFAULT_SLOTS, DEFAULT_STOCK, MENU_IMAGE_BUCKET } from "@/lib/config";
import { formatSlotLabel } from "@/lib/format";
import { defaultWindow, istInputToIso } from "@/lib/order-window";
import { rupeesToPaise } from "@/lib/money";

export interface FormState {
  ok?: boolean;
  message?: string;
}

const fail = (message: string): FormState => ({ ok: false, message });

async function guard(): Promise<FormState | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return fail("Not allowed.");
  }
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
const bool = (fd: FormData, key: string) => fd.get(key) === "on";

function done(message: string): FormState {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  return { ok: true, message };
}

const isUniqueViolation = (e: { code?: string } | null) => e?.code === "23505";
const isFkViolation = (e: { code?: string } | null) => e?.code === "23503";

// ---------------------------------------------------------------------------
// Service days
// ---------------------------------------------------------------------------

export async function createDay(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;

  const date = z.iso.date().safeParse(str(fd, "date"));
  if (!date.success) return fail("Pick a date.");
  const label = str(fd, "label").slice(0, 60) || null;
  const { opensAt, closesAt } = defaultWindow(date.data);

  const db = getAdminClient();
  const { data: day, error } = await db
    .from("service_days")
    .insert({
      date: date.data,
      label,
      is_enabled: true,
      is_tasting_day: bool(fd, "is_tasting_day"),
      opens_at: opensAt,
      closes_at: closesAt,
    })
    .select("id")
    .single<{ id: string }>();
  if (isUniqueViolation(error)) return fail("That date already exists.");
  if (error || !day) return fail(`Could not add day: ${error?.message}`);

  const [slotsRes, stockRes] = await Promise.all([
    db.from("slots").insert(
      DEFAULT_SLOTS.map((s) => ({
        service_day_id: day.id,
        label: formatSlotLabel(s.start, s.end),
        start_time: s.start,
        end_time: s.end,
        capacity: s.capacity,
      })),
    ),
    db.from("day_stock").insert(
      CATEGORIES.map((category) => ({ service_day_id: day.id, category, stock_limit: DEFAULT_STOCK[category] })),
    ),
  ]);
  if (slotsRes.error || stockRes.error) {
    return fail(`Day added, but default slots/stock failed: ${(slotsRes.error ?? stockRes.error)?.message}`);
  }
  return done("Day added with default slots and stock. Check the order window below.");
}

export async function updateDay(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;

  const id = z.uuid().safeParse(str(fd, "id"));
  if (!id.success) return fail("Invalid day.");
  const opensAt = istInputToIso(str(fd, "opens_at"));
  const closesAt = istInputToIso(str(fd, "closes_at"));
  if (opensAt === undefined || closesAt === undefined) return fail("Check the open/close times.");
  if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) {
    return fail("Orders must open before they close.");
  }

  const { error } = await getAdminClient()
    .from("service_days")
    .update({
      label: str(fd, "label").slice(0, 60) || null,
      opens_at: opensAt,
      closes_at: closesAt,
      is_enabled: bool(fd, "is_enabled"),
      is_tasting_day: bool(fd, "is_tasting_day"),
    })
    .eq("id", id.data);
  if (error) return fail(`Could not save: ${error.message}`);
  return done("Saved.");
}

export async function deleteDay(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;
  const id = z.uuid().safeParse(str(fd, "id"));
  if (!id.success) return fail("Invalid day.");

  const { error } = await getAdminClient().from("service_days").delete().eq("id", id.data);
  if (isFkViolation(error)) return fail("This day has orders, so it can't be deleted. Turn it off instead.");
  if (error) return fail(`Could not delete: ${error.message}`);
  return done("Day deleted.");
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

const Time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export async function saveSlot(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;

  const parsed = z
    .object({
      id: z.uuid().optional(),
      service_day_id: z.uuid(),
      start: Time,
      end: Time,
      capacity: z.coerce.number().int().min(0).max(1000),
    })
    .safeParse({
      id: str(fd, "id") || undefined,
      service_day_id: str(fd, "service_day_id"),
      start: str(fd, "start"),
      end: str(fd, "end"),
      capacity: str(fd, "capacity"),
    });
  if (!parsed.success) return fail("Check start, end and capacity.");
  const s = parsed.data;
  const start = s.start.slice(0, 5);
  const end = s.end.slice(0, 5);
  if (end <= start) return fail("End time must be after start time.");

  const row = {
    service_day_id: s.service_day_id,
    label: formatSlotLabel(start, end),
    start_time: start,
    end_time: end,
    capacity: s.capacity,
    is_enabled: s.id ? bool(fd, "is_enabled") : true,
  };
  const db = getAdminClient();
  const { error } = s.id ? await db.from("slots").update(row).eq("id", s.id) : await db.from("slots").insert(row);
  if (isUniqueViolation(error)) return fail("Another slot already starts at that time.");
  if (error) return fail(`Could not save slot: ${error.message}`);
  return done(s.id ? "Slot saved." : "Slot added.");
}

export async function deleteSlot(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;
  const id = z.uuid().safeParse(str(fd, "id"));
  if (!id.success) return fail("Invalid slot.");
  const { error } = await getAdminClient().from("slots").delete().eq("id", id.data);
  if (isFkViolation(error)) return fail("This slot has orders. Untick “On” to stop new orders instead.");
  if (error) return fail(`Could not delete: ${error.message}`);
  return done("Slot deleted.");
}

// ---------------------------------------------------------------------------
// Stock (shared per category per day)
// ---------------------------------------------------------------------------

export async function saveStock(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = z
    .object({
      service_day_id: z.uuid(),
      category: z.enum(CATEGORIES),
      stock_limit: z.coerce.number().int().min(0).max(10000),
    })
    .safeParse({
      service_day_id: str(fd, "service_day_id"),
      category: str(fd, "category"),
      stock_limit: str(fd, "stock_limit"),
    });
  if (!parsed.success) return fail("Enter a whole number.");

  const { error } = await getAdminClient()
    .from("day_stock")
    .upsert(parsed.data, { onConflict: "service_day_id,category" });
  if (error) return fail(`Could not save: ${error.message}`);
  return done("Stock saved.");
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "dish"
  );
}

export async function saveMenuItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const denied = await guard();
  if (denied) return denied;

  const parsed = z
    .object({
      id: z.uuid().optional(),
      name: z.string().min(2, "Name is too short").max(80),
      description: z.string().max(300),
      category: z.enum(CATEGORIES),
      sort_order: z.coerce.number().int().min(0).max(10000),
    })
    .safeParse({
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      description: str(fd, "description"),
      category: str(fd, "category"),
      sort_order: str(fd, "sort_order") || "0",
    });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");
  const pricePaise = rupeesToPaise(str(fd, "price_rupees"));
  if (pricePaise === null || pricePaise <= 0) return fail("Enter a price in rupees, like 35 or 35.50.");

  const db = getAdminClient();
  const item = parsed.data;

  // Image: upload new, remove, or keep.
  let imageUrl: string | null | undefined;
  const file = fd.get("image");
  if (file instanceof File && file.size > 0) {
    const ext = IMAGE_TYPES[file.type];
    if (!ext) return fail("Photo must be JPG, PNG or WebP.");
    if (file.size > MAX_IMAGE_BYTES) return fail("Photo is too big (max 5 MB).");
    const path = `${slugify(item.name)}-${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage
      .from(MENU_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (upErr) return fail(`Photo upload failed: ${upErr.message}`);
    imageUrl = db.storage.from(MENU_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (bool(fd, "remove_image")) {
    imageUrl = null;
  }

  const row = {
    name: item.name,
    description: item.description,
    category: item.category,
    price_paise: pricePaise,
    sort_order: item.sort_order,
    is_active: bool(fd, "is_active"),
    ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
  };

  if (item.id) {
    const { error } = await db.from("menu_items").update(row).eq("id", item.id);
    if (error) return fail(`Could not save: ${error.message}`);
    return done("Dish saved.");
  }

  // New dish: find a free slug.
  const base = slugify(item.name);
  const { data: taken } = await db.from("menu_items").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r: { slug: string }) => r.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  const { error } = await db.from("menu_items").insert({ ...row, slug });
  if (error) return fail(`Could not add dish: ${error.message}`);
  return done("Dish added.");
}
