// Order window rules. Pure functions (no server/browser APIs) so they can be unit tested.
// All calendar maths is done in Asia/Kolkata (IST, UTC+05:30, no DST).

const IST_OFFSET = "+05:30";

export interface WindowedDay {
  date: string; // YYYY-MM-DD
  is_enabled?: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

/** Calendar date in IST for an instant, as YYYY-MM-DD. */
export function istDate(now: Date | number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** True when the day is enabled, not in the past, and `now` is inside [opens_at, closes_at). NULL = unbounded. */
export function isDayOpen(day: WindowedDay, now: Date | number = Date.now()): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  if (day.is_enabled === false) return false;
  if (day.date < istDate(t)) return false;
  if (day.opens_at && t < Date.parse(day.opens_at)) return false;
  if (day.closes_at && t >= Date.parse(day.closes_at)) return false;
  return true;
}

/** Earliest future opening among enabled days that are not open yet. */
export function nextOpening(days: WindowedDay[], now: Date | number = Date.now()): string | null {
  const t = typeof now === "number" ? now : now.getTime();
  let best: number | null = null;
  for (const d of days) {
    if (d.is_enabled === false || !d.opens_at || d.date < istDate(t)) continue;
    const opens = Date.parse(d.opens_at);
    if (opens > t && (best === null || opens < best)) best = opens;
  }
  return best === null ? null : new Date(best).toISOString();
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "2026-11-27", "21:00" (IST) -> ISO instant */
export function istToIso(date: string, time: string): string {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${IST_OFFSET}`).toISOString();
}

/**
 * Default ordering window for a service day:
 * - opens 00:00 on the Friday before (Saturday → Friday, Sunday → Friday)
 * - closes 21:00 the day before (Saturday → Friday 21:00, Sunday → Saturday 21:00)
 */
export function defaultWindow(date: string): { opensAt: string; closesAt: string } {
  const back = (weekday(date) - 5 + 7) % 7 || 7; // days back to the previous Friday
  return {
    opensAt: istToIso(addDays(date, -back), "00:00"),
    closesAt: istToIso(addDays(date, -1), "21:00"),
  };
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in IST, for <input type="datetime-local">. */
export function isoToIstInput(iso: string | null): string {
  if (!iso) return "";
  const shifted = new Date(Date.parse(iso) + 330 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" typed in IST -> ISO instant. Empty -> null. Invalid -> undefined. */
export function istInputToIso(value: string): string | null | undefined {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const t = Date.parse(`${value}:00${IST_OFFSET}`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
