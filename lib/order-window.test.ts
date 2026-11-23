import { describe, expect, it } from "vitest";
import {
  addDays,
  defaultWindow,
  isDayOpen,
  istDate,
  istInputToIso,
  istToIso,
  isoToIstInput,
  nextOpening,
  weekday,
} from "@/lib/order-window";

// Fri 27 Nov 2026 / Sat 28 / Sun 29 are used throughout.
const at = (local: string) => Date.parse(`${local}+05:30`); // IST wall-clock -> epoch ms

describe("istDate", () => {
  it("uses the IST calendar day, not UTC", () => {
    // 18:31 UTC on the 27th is 00:01 IST on the 28th.
    expect(istDate(Date.parse("2026-11-27T18:31:00Z"))).toBe("2026-11-28");
    expect(istDate(Date.parse("2026-11-27T18:29:00Z"))).toBe("2026-11-27");
  });
});

describe("isDayOpen", () => {
  const day = {
    date: "2026-11-28",
    is_enabled: true,
    opens_at: istToIso("2026-11-27", "00:00"),
    closes_at: istToIso("2026-11-27", "21:00"),
  };

  it("is open inside the window", () => {
    expect(isDayOpen(day, at("2026-11-27T00:00:00"))).toBe(true); // opens_at is inclusive
    expect(isDayOpen(day, at("2026-11-27T20:59:59"))).toBe(true);
  });

  it("is closed before opens_at and from closes_at onwards", () => {
    expect(isDayOpen(day, at("2026-11-26T23:59:59"))).toBe(false);
    expect(isDayOpen(day, at("2026-11-27T21:00:00"))).toBe(false); // closes_at is exclusive
  });

  it("is closed when disabled", () => {
    expect(isDayOpen({ ...day, is_enabled: false }, at("2026-11-27T12:00:00"))).toBe(false);
  });

  it("treats NULL opens_at / closes_at as unbounded", () => {
    const open = { date: "2026-11-28", opens_at: null, closes_at: null };
    expect(isDayOpen(open, at("2026-11-20T10:00:00"))).toBe(true);
    expect(isDayOpen({ ...open, closes_at: istToIso("2026-11-27", "21:00") }, at("2026-11-27T22:00:00"))).toBe(
      false,
    );
  });

  it("never opens a day that is already in the past (IST)", () => {
    const open = { date: "2026-11-28", opens_at: null, closes_at: null };
    expect(isDayOpen(open, at("2026-11-28T23:59:00"))).toBe(true);
    expect(isDayOpen(open, at("2026-11-29T00:00:00"))).toBe(false);
  });
});

describe("defaultWindow (weekend schedule)", () => {
  it("Saturday: opens Friday 00:00, closes Friday 21:00", () => {
    expect(defaultWindow("2026-11-28")).toEqual({
      opensAt: new Date(at("2026-11-27T00:00:00")).toISOString(),
      closesAt: new Date(at("2026-11-27T21:00:00")).toISOString(),
    });
  });

  it("Sunday: opens Friday 00:00, closes Saturday 21:00", () => {
    expect(defaultWindow("2026-11-29")).toEqual({
      opensAt: new Date(at("2026-11-27T00:00:00")).toISOString(),
      closesAt: new Date(at("2026-11-28T21:00:00")).toISOString(),
    });
  });

  it("other days open on the previous Friday and close 21:00 the day before", () => {
    // Monday 30 Nov
    expect(defaultWindow("2026-11-30").opensAt).toBe(new Date(at("2026-11-27T00:00:00")).toISOString());
    expect(defaultWindow("2026-11-30").closesAt).toBe(new Date(at("2026-11-29T21:00:00")).toISOString());
    // A Friday opens the Friday before
    expect(defaultWindow("2026-12-04").opensAt).toBe(new Date(at("2026-11-27T00:00:00")).toISOString());
  });

  it("matches the weekend timeline end to end", () => {
    const sat = { date: "2026-11-28", ...toRow(defaultWindow("2026-11-28")) };
    const sun = { date: "2026-11-29", ...toRow(defaultWindow("2026-11-29")) };
    const open = (t: number) => [sat, sun].filter((d) => isDayOpen(d, t)).map((d) => weekday(d.date));

    expect(open(at("2026-11-26T23:00:00"))).toEqual([]); // Thursday night: closed
    expect(open(at("2026-11-27T10:00:00"))).toEqual([6, 0]); // Friday: Sat + Sun
    expect(open(at("2026-11-27T21:30:00"))).toEqual([0]); // Friday after 9 PM: Sun only
    expect(open(at("2026-11-28T20:59:00"))).toEqual([0]); // Saturday evening: Sun only
    expect(open(at("2026-11-28T21:00:00"))).toEqual([]); // Saturday 9 PM: all closed
  });
});

function toRow(w: { opensAt: string; closesAt: string }) {
  return { opens_at: w.opensAt, closes_at: w.closesAt };
}

describe("nextOpening", () => {
  const now = at("2026-11-23T12:00:00"); // Monday
  it("returns the earliest future opens_at of enabled days", () => {
    const days = [
      { date: "2026-11-29", opens_at: istToIso("2026-11-27", "00:00"), closes_at: null },
      { date: "2026-11-28", opens_at: istToIso("2026-11-27", "06:00"), closes_at: null },
      { date: "2026-11-28", is_enabled: false, opens_at: istToIso("2026-11-24", "00:00"), closes_at: null },
    ];
    expect(nextOpening(days, now)).toBe(istToIso("2026-11-27", "00:00"));
  });
  it("returns null when nothing is scheduled", () => {
    expect(nextOpening([], now)).toBeNull();
  });
});

describe("datetime-local conversion (IST)", () => {
  it("round-trips", () => {
    const iso = istInputToIso("2026-11-27T21:00");
    expect(iso).toBe("2026-11-27T15:30:00.000Z");
    expect(isoToIstInput(iso!)).toBe("2026-11-27T21:00");
  });
  it("handles empty and invalid input", () => {
    expect(istInputToIso("")).toBeNull();
    expect(istInputToIso("27/11/2026 9pm")).toBeUndefined();
    expect(isoToIstInput(null)).toBe("");
  });
});

describe("date helpers", () => {
  it("addDays crosses month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-01", -2)).toBe("2026-11-29");
  });
  it("weekday", () => {
    expect(weekday("2026-11-28")).toBe(6);
    expect(weekday("2026-11-29")).toBe(0);
  });
});
