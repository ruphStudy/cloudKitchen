import type { Cart, Category, MenuItem } from "@/lib/types";

export interface CartLine {
  item: MenuItem;
  quantity: number;
  lineTotalPaise: number;
}

export interface CartSummary {
  lines: CartLine[];
  count: number;
  totalPaise: number;
  byCategory: Partial<Record<Category, number>>;
}

/** Join the cart with current menu items. Unknown or inactive items are dropped. */
export function summarizeCart(cart: Cart, items: MenuItem[]): CartSummary {
  const lines: CartLine[] = [];
  const byCategory: Partial<Record<Category, number>> = {};
  let count = 0;
  let totalPaise = 0;
  for (const item of items) {
    const quantity = cart[item.id] ?? 0;
    if (quantity <= 0) continue;
    const lineTotalPaise = item.price_paise * quantity;
    lines.push({ item, quantity, lineTotalPaise });
    count += quantity;
    totalPaise += lineTotalPaise;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + quantity;
  }
  return { lines, count, totalPaise, byCategory };
}

export function itemsLabel(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

/** Indian mobile: 10 digits starting with 6-9. */
export const PHONE_REGEX = /^[6-9]\d{9}$/;

/** Accepts pasted "+91 98765 43210" / "098765..." and returns up to 10 digits. */
export function normalizePhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}
