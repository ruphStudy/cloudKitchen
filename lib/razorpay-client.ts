// Browser-only helpers for Razorpay Standard Checkout.

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailure {
  error: { code?: string; description?: string; reason?: string };
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { name?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  config?: unknown;
  retry?: { enabled: boolean };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", cb: (response: RazorpayFailure) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in browser"));
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Could not load Razorpay"));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export function openRazorpay(options: RazorpayOptions, onFailed: (r: RazorpayFailure) => void): void {
  if (!window.Razorpay) throw new Error("Razorpay not loaded");
  const rzp = new window.Razorpay(options);
  rzp.on("payment.failed", onFailed);
  rzp.open();
}

/** Show UPI first; other methods stay available below it. */
export const PREFER_UPI_CONFIG = {
  display: {
    blocks: {
      upi: { name: "Pay using UPI", instruments: [{ method: "upi" }] },
    },
    sequence: ["block.upi"],
    preferences: { show_default_blocks: true },
  },
};
