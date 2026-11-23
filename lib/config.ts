// Kitchen details shown to customers. Edit these to match your kitchen.
export const KITCHEN = {
  name: "Weekend Handi",
  tagline: "Home-cooked mutton & chicken bowls, fresh every weekend in Pune.",
  pickupAddress: "Flat 0, Your Society Name, Baner, Pune 411045",
  pickupNote: "Please show your order number at pickup.",
  /** WhatsApp number with country code, digits only (e.g. 919876543210). */
  whatsappNumber: "919999999999",
  whatsappMessage: "Hi! I'd like to know when the next orders open.",
} as const;

/** Max quantity of a single dish in one order. Keep in sync with the API schema. */
export const MAX_QTY_PER_ITEM = 20;

/** Rate limits for POST /api/orders. Per-phone pending limit lives in the place_order SQL. */
export const ORDER_RATE_LIMIT = { perIp: 10, windowSeconds: 10 * 60 } as const;

/** Defaults used when an admin adds a new service day. */
export const DEFAULT_SLOTS = [
  { start: "12:00", end: "13:00", capacity: 40 },
  { start: "13:00", end: "14:00", capacity: 40 },
  { start: "14:00", end: "15:00", capacity: 40 },
] as const;

export const DEFAULT_STOCK = { mutton: 75, chicken: 25 } as const;

export const CATEGORIES = ["mutton", "chicken"] as const;

export const MENU_IMAGE_BUCKET = "menu-images";
