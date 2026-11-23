// Stock and capacity counting. Mirrors the rules in the place_order / get_availability SQL:
// an order "holds" stock and slot capacity if it is paid/ready/picked_up, or if it is
// pending_payment and was created less than HOLD_MINUTES ago.

import type { Category, OrderStatus } from "@/lib/types";

export const HOLD_MINUTES = 10;
const HOLD_MS = HOLD_MINUTES * 60 * 1000;

export const CONFIRMED_STATUSES: readonly OrderStatus[] = ["paid", "ready", "picked_up"];

export function isConfirmed(status: OrderStatus): boolean {
  return CONFIRMED_STATUSES.includes(status);
}

export interface CountableOrder {
  status: OrderStatus;
  created_at: string;
  slot_id: string;
  items: { menu_item_id: string; category: string; quantity: number }[];
}

export function isFreshPending(o: Pick<CountableOrder, "status" | "created_at">, now: number): boolean {
  return o.status === "pending_payment" && now - Date.parse(o.created_at) < HOLD_MS;
}

export function isStalePending(o: Pick<CountableOrder, "status" | "created_at">, now: number): boolean {
  return o.status === "pending_payment" && !isFreshPending(o, now);
}

export function holdsStock(o: Pick<CountableOrder, "status" | "created_at">, now: number): boolean {
  return isConfirmed(o.status) || isFreshPending(o, now);
}

export interface DayUsage {
  /** Bowls per dish across paid + ready + picked_up. The cooking list. */
  dishTotals: Record<string, number>;
  /** Bowls per category across paid + ready + picked_up. */
  categorySold: Partial<Record<Category, number>>;
  /** Bowls per category held by unpaid orders still inside the hold window. */
  categoryHeld: Partial<Record<Category, number>>;
  /** Orders per slot that currently count against capacity. */
  slotBooked: Record<string, number>;
}

export function computeDayUsage(orders: CountableOrder[], now: number): DayUsage {
  const usage: DayUsage = { dishTotals: {}, categorySold: {}, categoryHeld: {}, slotBooked: {} };
  for (const o of orders) {
    const confirmed = isConfirmed(o.status);
    const held = !confirmed && isFreshPending(o, now);
    if (!confirmed && !held) continue;

    usage.slotBooked[o.slot_id] = (usage.slotBooked[o.slot_id] ?? 0) + 1;
    for (const it of o.items) {
      const cat = it.category as Category;
      if (confirmed) {
        usage.dishTotals[it.menu_item_id] = (usage.dishTotals[it.menu_item_id] ?? 0) + it.quantity;
        usage.categorySold[cat] = (usage.categorySold[cat] ?? 0) + it.quantity;
      } else {
        usage.categoryHeld[cat] = (usage.categoryHeld[cat] ?? 0) + it.quantity;
      }
    }
  }
  return usage;
}

/** Bowls still orderable for a category: limit minus sold minus held, never below 0. */
export function remainingStock(limit: number | undefined, sold = 0, held = 0): number {
  if (limit === undefined) return 0;
  return Math.max(0, limit - sold - held);
}
