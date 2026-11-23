import { describe, expect, it } from "vitest";
import { formatSlotLabel } from "@/lib/format";
import { paiseToRupeesInput, rupeesToPaise } from "@/lib/money";

describe("formatSlotLabel", () => {
  it("formats same-meridiem slots compactly", () => {
    expect(formatSlotLabel("12:00", "13:00")).toBe("12–1 PM");
    expect(formatSlotLabel("13:00:00", "14:00:00")).toBe("1–2 PM");
  });
  it("shows both meridiems when they differ, and minutes when present", () => {
    expect(formatSlotLabel("11:00", "12:00")).toBe("11 AM–12 PM");
    expect(formatSlotLabel("11:30", "12:30")).toBe("11:30 AM–12:30 PM");
  });
});

describe("rupees <-> paise", () => {
  it("parses rupee strings without float errors", () => {
    expect(rupeesToPaise("35")).toBe(3500);
    expect(rupeesToPaise("35.5")).toBe(3550);
    expect(rupeesToPaise("35.50")).toBe(3550);
    expect(rupeesToPaise("0.29")).toBe(29);
    expect(rupeesToPaise("₹1,200")).toBe(120000);
  });
  it("rejects bad input", () => {
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("35.555")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
  it("formats paise for inputs", () => {
    expect(paiseToRupeesInput(3500)).toBe("35");
    expect(paiseToRupeesInput(3550)).toBe("35.50");
  });
});
