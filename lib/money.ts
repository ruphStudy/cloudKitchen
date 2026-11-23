/**
 * "35" -> 3500, "35.5" -> 3550, "35.50" -> 3550, "₹1,200" -> 120000.
 * Parses the string directly (no floating point). Returns null if it isn't a valid amount.
 */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, "");
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** 3550 -> "35.50", 3500 -> "35" (for form inputs). */
export function paiseToRupeesInput(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, "0")}`;
}
