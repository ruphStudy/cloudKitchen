import { describe, expect, it } from "vitest";
import { csvCell, paiseToRupees, toCsv } from "@/lib/csv";
import { aggregateByDish, normalizeOrderNo, type FeedbackRow } from "@/lib/feedback";
import { feedbackRequestMessage, orderWhatsAppMessage, waLink } from "@/lib/whatsapp";
import { couponErrorMessage } from "@/lib/coupon-errors";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("neutralises formula injection in text cells", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5"); // real numbers are left alone
  });

  it("adds a BOM and CRLF line endings for Excel", () => {
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("﻿A,B\r\n1,x\r\n");
  });

  it("formats paise as rupees", () => {
    expect(paiseToRupees(3550)).toBe("35.50");
    expect(paiseToRupees(null)).toBe("");
  });
});

describe("whatsapp", () => {
  it("builds a wa.me link with an encoded message", () => {
    expect(waLink("+91 98765-43210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });

  it("order message has order no, name, day, slot and items", () => {
    const msg = orderWhatsAppMessage({
      orderNo: "K-1001",
      name: "Asha",
      day: "Saturday, 28 November",
      slot: "12–1 PM",
      items: [
        { quantity: 2, name: "Mutton Sukha bowl" },
        { quantity: 1, name: "Chicken Curry bowl" },
      ],
      totalPaise: 9500,
    });
    expect(msg).toContain("Order: K-1001");
    expect(msg).toContain("Name: Asha");
    expect(msg).toContain("Pickup: Saturday, 28 November, 12–1 PM");
    expect(msg).toContain("Items: 2 × Mutton Sukha bowl, 1 × Chicken Curry bowl");
    expect(msg).toContain("₹95");
  });

  it("feedback request message includes the token link", () => {
    expect(feedbackRequestMessage("Asha", "K-1001", "https://x.in/feedback/abc")).toContain("https://x.in/feedback/abc");
  });
});

describe("feedback", () => {
  it("normalises order numbers typed from the bowl", () => {
    expect(normalizeOrderNo("1001")).toBe("K-1001");
    expect(normalizeOrderNo("k1001")).toBe("K-1001");
    expect(normalizeOrderNo(" K-1001 ")).toBe("K-1001");
    expect(normalizeOrderNo("K 1001")).toBe("K-1001");
    expect(normalizeOrderNo("abc")).toBeNull();
    expect(normalizeOrderNo("K-12")).toBeNull();
  });

  it("averages taste per dish and counts spice/quantity", () => {
    const row = (rating: number, items: [string, string][], spice: FeedbackRow["spice"] = null): FeedbackRow => ({
      rating,
      spice,
      quantity_feel: "right",
      comment: null,
      created_at: "2026-11-28T10:00:00Z",
      order_no: "K-1",
      items: items.map(([menu_item_id, name]) => ({ menu_item_id, name })),
    });
    const stats = aggregateByDish([
      row(5, [["ms", "Mutton Sukha"]], "more"),
      row(4, [["ms", "Mutton Sukha"], ["cc", "Chicken Curry"]], "right"),
      row(2, [["cc", "Chicken Curry"], ["cc", "Chicken Curry"]]), // duplicate line counted once
    ]);
    expect(stats).toEqual([
      expect.objectContaining({ menuItemId: "ms", count: 2, avgTaste: 4.5, spice: { less: 0, right: 1, more: 1 } }),
      expect.objectContaining({ menuItemId: "cc", count: 2, avgTaste: 3, quantity: { less: 0, right: 2, more: 0 } }),
    ]);
  });
});

describe("coupon messages", () => {
  it("maps DB errors to friendly text", () => {
    expect(couponErrorMessage("COUPON_MIN_ORDER", "10000")).toBe("This coupon needs an order of at least ₹100.");
    expect(couponErrorMessage("COUPON_USED_UP")).toBe("This coupon has been fully used.");
    expect(couponErrorMessage("SLOT_FULL")).toBeNull();
  });
});
