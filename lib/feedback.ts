export type Feel = "less" | "right" | "more";

export const FEELS: readonly Feel[] = ["less", "right", "more"];

export const FEEL_LABEL: Record<Feel, string> = {
  less: "Want less",
  right: "Just right",
  more: "Want more",
};

export const TASTE_FACES = ["😖", "😕", "😐", "😋", "🤩"] as const;
export const TASTE_LABELS = ["Not good", "Okay-ish", "Good", "Very good", "Loved it"] as const;

/** "1001", "k1001", "K 1001", "k-1001" -> "K-1001". Null if it doesn't look like an order number. */
export function normalizeOrderNo(input: string): string | null {
  const m = /^\s*k?\s*-?\s*(\d{3,8})\s*$/i.exec(input);
  return m ? `K-${m[1]}` : null;
}

export interface FeedbackRow {
  rating: number;
  spice: Feel | null;
  quantity_feel: Feel | null;
  comment: string | null;
  created_at: string;
  order_no: string;
  items: { menu_item_id: string; name: string }[];
}

export interface DishFeedbackStats {
  menuItemId: string;
  name: string;
  count: number;
  avgTaste: number;
  spice: Record<Feel, number>;
  quantity: Record<Feel, number>;
}

const emptyFeel = (): Record<Feel, number> => ({ less: 0, right: 0, more: 0 });

/**
 * Per-dish stats. A feedback counts once for each distinct dish in its order
 * (tasting orders have exactly one dish).
 */
export function aggregateByDish(rows: FeedbackRow[]): DishFeedbackStats[] {
  const map = new Map<string, DishFeedbackStats & { sum: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const it of r.items) {
      if (seen.has(it.menu_item_id)) continue;
      seen.add(it.menu_item_id);
      const s =
        map.get(it.menu_item_id) ??
        { menuItemId: it.menu_item_id, name: it.name, count: 0, avgTaste: 0, sum: 0, spice: emptyFeel(), quantity: emptyFeel() };
      s.count += 1;
      s.sum += r.rating;
      if (r.spice) s.spice[r.spice] += 1;
      if (r.quantity_feel) s.quantity[r.quantity_feel] += 1;
      map.set(it.menu_item_id, s);
    }
  }
  return [...map.values()]
    .map(({ sum, ...s }) => ({ ...s, avgTaste: Math.round((sum / s.count) * 10) / 10 }))
    .sort((a, b) => b.avgTaste - a.avgTaste || a.name.localeCompare(b.name));
}
