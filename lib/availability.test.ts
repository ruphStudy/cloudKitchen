import { describe, expect, it } from "vitest";
import {
  computeDayUsage,
  holdsStock,
  isFreshPending,
  isStalePending,
  remainingStock,
  type CountableOrder,
} from "@/lib/availability";
import type { OrderStatus } from "@/lib/types";

const NOW = Date.parse("2026-11-28T06:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const MS = "mutton-sukha";
const MC = "mutton-curry";
const CS = "chicken-sukha";

function order(
  status: OrderStatus,
  ageMinutes: number,
  slot: string,
  items: [string, "mutton" | "chicken", number][],
): CountableOrder {
  return {
    status,
    created_at: minsAgo(ageMinutes),
    slot_id: slot,
    items: items.map(([menu_item_id, category, quantity]) => ({ menu_item_id, category, quantity })),
  };
}

describe("hold window", () => {
  it("pending orders hold stock for less than 10 minutes", () => {
    expect(isFreshPending(order("pending_payment", 9.9, "s1", []), NOW)).toBe(true);
    expect(isFreshPending(order("pending_payment", 10, "s1", []), NOW)).toBe(false); // same as SQL: created_at > now() - 10 min
    expect(isStalePending(order("pending_payment", 10, "s1", []), NOW)).toBe(true);
  });

  it("paid, ready and picked_up always hold; cancelled never does", () => {
    for (const s of ["paid", "ready", "picked_up"] as const) {
      expect(holdsStock(order(s, 999, "s1", []), NOW)).toBe(true);
    }
    expect(holdsStock(order("cancelled", 0, "s1", []), NOW)).toBe(false);
  });
});

describe("computeDayUsage", () => {
  const orders: CountableOrder[] = [
    order("paid", 60, "s1", [[MS, "mutton", 2], [CS, "chicken", 1]]),
    order("ready", 50, "s1", [[MC, "mutton", 3]]),
    order("picked_up", 40, "s2", [[MS, "mutton", 1]]),
    order("pending_payment", 2, "s2", [[MS, "mutton", 4]]), // fresh: held, not sold
    order("pending_payment", 15, "s2", [[CS, "chicken", 5]]), // stale: ignored
    order("cancelled", 30, "s1", [[MC, "mutton", 10]]), // ignored
  ];
  const usage = computeDayUsage(orders, NOW);

  it("dish totals (cooking list) only count paid + ready + picked_up", () => {
    expect(usage.dishTotals).toEqual({ [MS]: 3, [MC]: 3, [CS]: 1 });
  });

  it("mutton dishes share one category total", () => {
    expect(usage.categorySold).toEqual({ mutton: 6, chicken: 1 });
  });

  it("fresh pending orders are 'on hold', stale ones are not", () => {
    expect(usage.categoryHeld).toEqual({ mutton: 4 });
  });

  it("slot bookings count orders (not bowls) that hold capacity", () => {
    expect(usage.slotBooked).toEqual({ s1: 2, s2: 2 });
  });

  it("an order that ages past 10 minutes releases its hold", () => {
    const later = computeDayUsage(orders, NOW + 9 * 60_000);
    expect(later.categoryHeld).toEqual({});
    expect(later.slotBooked).toEqual({ s1: 2, s2: 1 });
  });
});

describe("remainingStock", () => {
  it("is limit minus sold minus held", () => {
    expect(remainingStock(75, 48, 4)).toBe(23);
  });
  it("never goes below zero (e.g. limit lowered after selling)", () => {
    expect(remainingStock(20, 25, 0)).toBe(0);
  });
  it("is zero when no limit is set for the category", () => {
    expect(remainingStock(undefined, 0, 0)).toBe(0);
  });
});
