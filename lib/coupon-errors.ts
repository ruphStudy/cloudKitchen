import { formatPaise } from "@/lib/format";

/** Customer-facing messages for errors raised by evaluate_coupon / place_order. */
export function couponErrorMessage(code: string, details?: string | null): string | null {
  switch (code) {
    case "COUPON_INVALID":
      return "That coupon code isn't valid.";
    case "COUPON_INACTIVE":
      return "This coupon isn't active right now.";
    case "COUPON_MIN_ORDER": {
      const min = Number(details);
      return Number.isFinite(min) && min > 0
        ? `This coupon needs an order of at least ${formatPaise(min)}.`
        : "Add a little more to use this coupon.";
    }
    case "COUPON_USED_UP":
      return "This coupon has been fully used.";
    default:
      return null;
  }
}
