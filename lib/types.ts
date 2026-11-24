export type Category = "mutton" | "chicken";

export type OrderStatus = "pending_payment" | "paid" | "ready" | "picked_up" | "cancelled" | "refunded";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: Category;
  price_paise: number;
  image_url: string | null;
}

export interface CatalogSlot {
  id: string;
  label: string;
  remaining: number;
}

export interface CatalogDay {
  id: string;
  date: string; // YYYY-MM-DD
  label: string | null;
  isTastingDay: boolean;
  /** Open slots with capacity left (full slots are removed). */
  slots: CatalogSlot[];
  /** Bowls left per category. Missing category = not available that day. */
  stockRemaining: Partial<Record<Category, number>>;
}

export interface Catalog {
  items: MenuItem[];
  /** Days that are enabled and currently open for orders. */
  days: CatalogDay[];
  /** When the next not-yet-open day opens (ISO), if any. */
  nextOpensAt: string | null;
}

export type Cart = Record<string, number>; // menuItemId -> quantity
