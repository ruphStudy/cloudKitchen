const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 6000 -> "₹60" */
export function formatPaise(paise: number): string {
  return rupees.format(paise / 100);
}

function dateAtNoonIST(date: string): Date {
  return new Date(`${date}T12:00:00+05:30`);
}

/** "2026-11-28" -> "Sat, 28 Nov" */
export function formatDayShort(date: string): string {
  return dateAtNoonIST(date).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** "2026-11-28" -> "Saturday, 28 November" */
export function formatDayLong(date: string): string {
  return dateAtNoonIST(date).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });
}

/** "2026-11-28" -> "Sat" */
export function weekdayShort(date: string): string {
  return dateAtNoonIST(date).toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
}

/** ISO instant -> "Friday" (IST) */
export function weekdayLongOfInstant(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
}

/** ISO instant -> "Fri 27 Nov, 9:00 pm" (IST) */
export function formatInstantIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(":").map(Number);
  return { h, m };
}

function clock(h: number, m: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
}

/** ("12:00", "13:00") -> "12–1 PM"; ("11:30", "12:30") -> "11:30 AM–12:30 PM" */
export function formatSlotLabel(start: string, end: string): string {
  const a = parseTime(start);
  const b = parseTime(end);
  const ap = a.h < 12 ? "AM" : "PM";
  const bp = b.h < 12 ? "AM" : "PM";
  return ap === bp
    ? `${clock(a.h, a.m)}–${clock(b.h, b.m)} ${bp}`
    : `${clock(a.h, a.m)} ${ap}–${clock(b.h, b.m)} ${bp}`;
}
