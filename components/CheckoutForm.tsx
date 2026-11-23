"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { PHONE_REGEX, normalizePhoneInput, summarizeCart } from "@/lib/cart";
import { KITCHEN } from "@/lib/config";
import { formatDayShort, formatPaise } from "@/lib/format";
import { PREFER_UPI_CONFIG, loadRazorpay, openRazorpay, type RazorpaySuccess } from "@/lib/razorpay-client";
import type { Catalog, CatalogDay, Category } from "@/lib/types";

const CUSTOMER_KEY = "ck_customer_v1";
/** Reuse a created order for retries within this window (server holds stock for 10 min). */
const REUSE_ORDER_MS = 8 * 60 * 1000;

type Phase = "idle" | "creating" | "paying" | "verifying";

interface CreatedOrder {
  orderId: string;
  orderNo: string;
  publicToken: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
}

interface PendingOrder {
  signature: string;
  createdAt: number;
  order: CreatedOrder;
}

function dayCanFulfil(day: CatalogDay, byCategory: Partial<Record<Category, number>>): boolean {
  if (day.slots.length === 0) return false;
  return (Object.entries(byCategory) as [Category, number][]).every(
    ([cat, qty]) => qty <= (day.stockRemaining[cat] ?? 0),
  );
}

export function CheckoutForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const { cart, ready, clear } = useCart();
  const summary = useMemo(() => summarizeCart(cart, catalog.items), [cart, catalog.items]);

  const [dayId, setDayId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRef = useRef<PendingOrder | null>(null);
  const failureRef = useRef<string | null>(null);

  // Prefill customer details and warm up the Razorpay script.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOMER_KEY) ?? "null") as {
        name?: unknown;
        phone?: unknown;
      } | null;
      if (typeof saved?.name === "string") setName(saved.name);
      if (typeof saved?.phone === "string") setPhone(normalizePhoneInput(saved.phone));
    } catch {
      // ignore
    }
    loadRazorpay().catch(() => undefined);
  }, []);

  const eligibleDays = useMemo(
    () => catalog.days.filter((d) => dayCanFulfil(d, summary.byCategory)),
    [catalog.days, summary.byCategory],
  );
  const selectedDay = eligibleDays.find((d) => d.id === dayId) ?? null;
  const selectedSlot = selectedDay?.slots.find((s) => s.id === slotId) ?? null;

  // Auto-pick the day when there is only one choice; drop selections that became invalid.
  useEffect(() => {
    if (dayId && !eligibleDays.some((d) => d.id === dayId)) setDayId(null);
    else if (!dayId && eligibleDays.length === 1) setDayId(eligibleDays[0].id);
  }, [dayId, eligibleDays]);
  useEffect(() => {
    if (slotId && !selectedSlot) setSlotId(null);
  }, [slotId, selectedSlot]);

  const nameError = name.trim().length < 2 ? "Please enter your name" : null;
  const phoneError = !PHONE_REGEX.test(phone) ? "Enter a valid 10-digit mobile number" : null;
  const formValid = !!selectedDay && !!selectedSlot && !nameError && !phoneError;
  const busy = phase !== "idle";

  if (!ready) {
    return <CheckoutShell><p className="p-4 text-stone-500">Loading…</p></CheckoutShell>;
  }

  if (phase === "verifying") {
    return (
      <CheckoutShell>
        <div className="flex flex-col items-center gap-4 p-10 text-center">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
          <p className="text-lg font-semibold">Confirming your payment…</p>
          <p className="text-sm text-stone-500">Please don&apos;t close this page.</p>
        </div>
      </CheckoutShell>
    );
  }

  if (summary.count === 0) {
    return (
      <CheckoutShell>
        <div className="p-6 text-center">
          <p className="text-lg">Your cart is empty.</p>
          <Link href="/" className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-3 font-bold text-white">
            See the menu
          </Link>
        </div>
      </CheckoutShell>
    );
  }

  async function createOrder(): Promise<CreatedOrder | null> {
    const payload = {
      serviceDayId: selectedDay!.id,
      slotId: selectedSlot!.id,
      name: name.trim(),
      phone,
      fulfilment: "pickup" as const,
      items: summary.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity })),
    };
    const signature = JSON.stringify(payload);
    const pending = pendingRef.current;
    if (pending && pending.signature === signature && Date.now() - pending.createdAt < REUSE_ORDER_MS) {
      return pending.order;
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signature,
    });
    const data = (await res.json().catch(() => null)) as
      | (CreatedOrder & { error?: undefined })
      | { error: { code: string; message: string } }
      | null;

    if (!res.ok || !data || data.error) {
      setNotice(data?.error?.message ?? "Something went wrong. Please try again.");
      if (res.status === 409) router.refresh(); // reload live slots and stock
      return null;
    }
    pendingRef.current = { signature, createdAt: Date.now(), order: data };
    return data;
  }

  async function onPaid(order: CreatedOrder, response: RazorpaySuccess) {
    setPhase("verifying");
    clear(); // Payment went through; the order page shows the final status.
    pendingRef.current = null;
    try {
      await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });
    } catch {
      // The webhook will still confirm the order; the order page polls for it.
    }
    router.replace(`/order/${order.publicToken}`);
  }

  async function pay() {
    setShowErrors(true);
    setNotice(null);
    if (!formValid || busy) return;

    try {
      window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name: name.trim(), phone }));
    } catch {
      // ignore
    }

    setPhase("creating");
    try {
      const [order] = await Promise.all([createOrder(), loadRazorpay()]);
      if (!order) {
        setPhase("idle");
        return;
      }

      failureRef.current = null;
      setPhase("paying");
      openRazorpay(
        {
          key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
          order_id: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: KITCHEN.name,
          description: `Order ${order.orderNo}`,
          prefill: { name: name.trim(), contact: `+91${phone}` },
          notes: { order_no: order.orderNo },
          theme: { color: "#c2410c" },
          config: PREFER_UPI_CONFIG,
          handler: (response) => void onPaid(order, response),
          modal: {
            ondismiss: () => {
              setPhase("idle");
              setNotice(
                failureRef.current
                  ? `Payment failed: ${failureRef.current}. Your cart is saved — tap Try again.`
                  : "Payment was not completed. Your cart is saved — tap Try again.",
              );
            },
          },
        },
        (failure) => {
          failureRef.current = failure.error.description ?? "the payment did not go through";
        },
      );
    } catch {
      setPhase("idle");
      setNotice("Could not open the payment page. Check your internet and tap Try again.");
    }
  }

  const payLabel =
    phase === "creating"
      ? "Placing order…"
      : phase === "paying"
        ? "Waiting for payment…"
        : notice
          ? `Try again · Pay ${formatPaise(summary.totalPaise)}`
          : `Pay ${formatPaise(summary.totalPaise)}`;

  return (
    <CheckoutShell>
      <div className="space-y-6 px-4 pb-36 pt-4">
        {/* Day */}
        <section>
          <h2 className="mb-2 text-base font-semibold">1. Pick a day</h2>
          {catalog.days.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-3 text-amber-900">Orders are closed right now.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {catalog.days.map((day) => {
                const eligible = eligibleDays.some((d) => d.id === day.id);
                const active = day.id === dayId;
                return (
                  <button
                    key={day.id}
                    type="button"
                    disabled={!eligible || busy}
                    onClick={() => {
                      setDayId(day.id);
                      setSlotId(null);
                    }}
                    className={`min-h-14 rounded-xl border-2 px-3 py-2 text-left font-semibold ${
                      active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-200 bg-white"
                    } disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-400`}
                    aria-pressed={active}
                  >
                    {formatDayShort(day.date)}
                    {(day.label || day.isTastingDay) && (
                      <span className="block text-xs font-normal">
                        {day.label ?? "Tasting day"}
                      </span>
                    )}
                    {!eligible && (
                      <span className="block text-xs font-normal">
                        {day.slots.length === 0 ? "Fully booked" : "Not enough left for your cart"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {showErrors && !selectedDay && eligibleDays.length > 0 && (
            <p className="mt-1 text-sm text-red-600">Please pick a day.</p>
          )}
        </section>

        {/* Slot */}
        {selectedDay && (
          <section>
            <h2 className="mb-2 text-base font-semibold">2. Pick a pickup time</h2>
            <div className="grid grid-cols-3 gap-2">
              {selectedDay.slots.map((slot) => {
                const active = slot.id === slotId;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSlotId(slot.id)}
                    className={`min-h-12 rounded-xl border-2 px-2 text-base font-semibold ${
                      active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-200 bg-white"
                    }`}
                    aria-pressed={active}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
            {showErrors && !selectedSlot && <p className="mt-1 text-sm text-red-600">Please pick a time.</p>}
          </section>
        )}

        {/* Contact */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">3. Your details</h2>
          <label className="block">
            <span className="mb-1 block text-sm text-stone-600">Name</span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              disabled={busy}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="h-12 w-full rounded-xl border-2 border-stone-200 bg-white px-3 text-base outline-none focus:border-brand-600"
              placeholder="Your name"
            />
            {showErrors && nameError && <span className="mt-1 block text-sm text-red-600">{nameError}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-stone-600">Mobile number</span>
            <div className="flex h-12 items-center rounded-xl border-2 border-stone-200 bg-white focus-within:border-brand-600">
              <span className="pl-3 pr-1 text-base text-stone-500">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                disabled={busy}
                onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
                className="h-full w-full rounded-r-xl bg-transparent px-2 text-base tracking-wide outline-none"
                placeholder="98765 43210"
              />
            </div>
            {showErrors && phoneError && <span className="mt-1 block text-sm text-red-600">{phoneError}</span>}
          </label>
        </section>

        {/* Pickup */}
        <section className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
          <h2 className="text-base font-semibold">Pickup</h2>
          <p className="mt-1 text-sm text-stone-600">{KITCHEN.pickupAddress}</p>
        </section>

        {/* Summary */}
        <section className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Order summary</h2>
            <Link href="/" className="py-2 text-sm font-semibold text-brand-600">
              Edit
            </Link>
          </div>
          <ul className="mt-1 space-y-1 text-base">
            {summary.lines.map((l) => (
              <li key={l.item.id} className="flex justify-between gap-2">
                <span>
                  {l.quantity} × {l.item.name}
                </span>
                <span className="shrink-0">{formatPaise(l.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-lg font-bold">
            <span>Total</span>
            <span>{formatPaise(summary.totalPaise)}</span>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t border-stone-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {notice && (
          <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
            {notice}
          </p>
        )}
        <button
          type="button"
          onClick={pay}
          disabled={busy || catalog.days.length === 0}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-lg active:bg-brand-700 disabled:opacity-70"
        >
          {busy && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {payLabel}
        </button>
      </div>
    </CheckoutShell>
  );
}

function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <header className="flex items-center gap-2 border-b border-stone-200 bg-white px-2 py-2">
        <Link href="/" className="flex h-11 w-11 items-center justify-center text-2xl" aria-label="Back to menu">
          ←
        </Link>
        <h1 className="text-lg font-bold">Checkout</h1>
      </header>
      {children}
    </main>
  );
}
