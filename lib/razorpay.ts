import "server-only";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import { serverEnv } from "@/lib/env";

let instance: Razorpay | undefined;

export function getRazorpay(): Razorpay {
  instance ??= new Razorpay({ key_id: serverEnv.razorpayKeyId, key_secret: serverEnv.razorpayKeySecret });
  return instance;
}

function safeEqualHex(expectedHex: string, received: string): boolean {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function isValidPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", serverEnv.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret). */
export function isValidWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", serverEnv.razorpayWebhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}
