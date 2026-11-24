"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { AdminDay, AdminMenuItem, AdminOrder, AdminSlot, AdminStock } from "@/lib/admin-data";
import { computeDayUsage, isConfirmed, isStalePending, remainingStock } from "@/lib/availability";
import { CATEGORIES } from "@/lib/config";
import { formatDayLong, formatPaise } from "@/lib/format";
import { weekday } from "@/lib/order-window";
import { getBrowserClient } from "@/lib/supabase/browser";
import { OrderRow } from "@/components/admin/OrderRow";

type StatusFilter = "all" | "paid" | "ready" | "picked_up" | "cancelled" | "refunded";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "ready", label: "Ready" },
  { value: "picked_up", label: "Picked up" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
];

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  days: { id: string; date: string; label: string | null }[];
  day: AdminDay;
  today: string;
  slots: AdminSlot[];
  stock: AdminStock[];
  menu: AdminMenuItem[];
  orders: AdminOrder[];
  serverNow: number;
  siteUrl: string;
}

function matchesSearch(o: AdminOrder, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  const digits = needle.replace(/\D/g, "");
  return (
    o.customer_name.toLowerCase().includes(needle) ||
    o.order_no.toLowerCase().includes(needle) ||
    (digits.length >= 3 && (o.customer_phone.includes(digits) || o.order_no.includes(digits)))
  );
}

/** Two short tones via Web Audio, so no sound file is needed. */
function beep(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.4, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.17);
  }
}

export function AdminDashboard({ days, day, today, slots, stock, menu, orders, serverNow, siteUrl }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [showStale, setShowStale] = useState(false);
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  // Keep "now" ticking so pending orders age out of view without a reload.
  useEffect(() => setNow(serverNow), [serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // --- Live refresh -------------------------------------------------------
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 400);
  }, [router]);

  useEffect(() => {
    const supabase = getBrowserClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`admin-orders-${day.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `service_day_id=eq.${day.id}` },
          () => refresh(),
        )
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    })();

    // Fallbacks: refresh when the phone wakes up, and every minute.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(refresh, 60_000);

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
    };
  }, [day.id, refresh]);

  // --- New paid order alert -----------------------------------------------
  const seen = useRef<{ dayId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const confirmedIds = orders.filter((o) => isConfirmed(o.status)).map((o) => o.id);
    if (!seen.current || seen.current.dayId !== day.id) {
      seen.current = { dayId: day.id, ids: new Set(confirmedIds) };
      setNewCount(0);
      return;
    }
    const fresh = confirmedIds.filter((id) => !seen.current!.ids.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.current.ids.add(id);
    setNewCount((c) => c + fresh.length);
    if (soundOn && audioRef.current) beep(audioRef.current);
  }, [orders, day.id, soundOn]);

  function toggleSound() {
    if (!soundOn) {
      // Must be created from a tap, or mobile browsers keep it muted.
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
      beep(audioRef.current);
    }
    setSoundOn((s) => !s);
  }

  // --- Derived data -------------------------------------------------------
  const usage = useMemo(() => computeDayUsage(orders, now), [orders, now]);
  const confirmed = orders.filter((o) => isConfirmed(o.status));
  const revenue = confirmed.reduce((sum, o) => sum + o.total_paise, 0);
  const waiting = orders.filter((o) => o.status === "paid" || o.status === "ready").length;
  const staleCount = orders.filter((o) => isStalePending(o, now)).length;
  const refundsNeeded = orders.filter((o) => o.status === "cancelled" && o.razorpay_payment_id).length;

  const visible = orders.filter((o) => {
    if (o.status === "pending_payment") {
      if (filter !== "all") return false;
      if (!showStale && isStalePending(o, now)) return false;
    } else if (filter !== "all" && o.status !== filter) {
      return false;
    }
    return matchesSearch(o, query);
  });

  const dishRows = menu
    .filter((m) => m.is_active || (usage.dishTotals[m.id] ?? 0) > 0)
    .map((m) => ({ id: m.id, name: m.name, category: m.category, qty: usage.dishTotals[m.id] ?? 0 }));

  return (
    <main className="space-y-4 px-3 pb-16 pt-3">
      {/* Day switcher */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        {days.map((d) => {
          const active = d.id === day.id;
          return (
            <Link
              key={d.id}
              href={`/admin?day=${d.id}`}
              className={`flex min-h-12 shrink-0 flex-col justify-center rounded-xl px-4 text-center text-sm font-semibold ${
                active ? "bg-brand-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"
              }`}
            >
              <span>
                {WEEKDAY[weekday(d.date)]} {Number(d.date.slice(8))}
              </span>
              {d.date === today && <span className="text-[11px] font-normal">Today</span>}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold leading-tight">
          {formatDayLong(day.date)}
          {day.label && <span className="block text-sm font-normal text-stone-500">{day.label}</span>}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${live ? "bg-green-500" : "bg-stone-300"}`}
            title={live ? "Live" : "Connecting…"}
          />
          <button
            type="button"
            onClick={toggleSound}
            className="h-10 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-stone-200"
            aria-pressed={soundOn}
          >
            {soundOn ? "🔔 Sound on" : "🔕 Sound off"}
          </button>
        </div>
      </div>

      {newCount > 0 && (
        <button
          type="button"
          onClick={() => setNewCount(0)}
          className="w-full rounded-xl bg-green-600 py-3 text-base font-bold text-white"
        >
          {newCount} new paid order{newCount === 1 ? "" : "s"} · tap to dismiss
        </button>
      )}

      {refundsNeeded > 0 && (
        <button
          type="button"
          onClick={() => setFilter("cancelled")}
          className="w-full rounded-xl bg-red-600 py-3 text-base font-bold text-white"
        >
          {refundsNeeded} order{refundsNeeded === 1 ? "" : "s"} need{refundsNeeded === 1 ? "s" : ""} a refund · show
        </button>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Paid orders" value={String(confirmed.length)} />
        <Stat label="Revenue" value={formatPaise(revenue)} />
        <Stat label="To pick up" value={String(waiting)} />
      </div>

      {/* Cooking list */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-base font-bold">Dish totals</h2>
        <ul className="mt-2 divide-y divide-stone-100">
          {dishRows.map((d) => (
            <li key={d.id} className="flex justify-between py-2 text-base">
              <span>{d.name}</span>
              <span className="text-xl font-bold tabular-nums">{d.qty}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          {CATEGORIES.map((cat) => {
            const limit = stock.find((s) => s.category === cat)?.stock_limit;
            const sold = usage.categorySold[cat] ?? 0;
            const held = usage.categoryHeld[cat] ?? 0;
            const pct = limit ? Math.min(100, Math.round(((sold + held) / limit) * 100)) : 0;
            return (
              <div key={cat}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold capitalize">{cat}</span>
                  <span className="tabular-nums">
                    {limit === undefined ? (
                      "No stock set"
                    ) : (
                      <>
                        <b>{sold}</b> / {limit} sold
                        {held > 0 && ` · ${held} on hold`} · {remainingStock(limit, sold, held)} left
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <a
        href={`/api/admin/export/orders?day=${day.id}`}
        className="flex h-12 items-center justify-center rounded-xl bg-white text-base font-semibold ring-1 ring-stone-200"
      >
        ⬇ Export orders CSV ({formatDayLong(day.date)})
      </a>

      {/* Filters */}
      <div className="space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone or order no"
          className="h-12 w-full rounded-xl border-2 border-stone-200 bg-white px-3 text-base outline-none focus:border-brand-600"
        />
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${
                filter === f.value ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {staleCount > 0 && filter === "all" && (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showStale}
              onChange={(e) => setShowStale(e.target.checked)}
              className="h-5 w-5"
            />
            Show {staleCount} expired unpaid order{staleCount === 1 ? "" : "s"}
          </label>
        )}
      </div>

      {/* Orders grouped by slot */}
      {slots.map((slot) => {
        const rows = visible.filter((o) => o.slot_id === slot.id);
        return (
          <section key={slot.id}>
            <h2 className="sticky top-[60px] z-10 -mx-3 bg-stone-100/95 px-3 py-2 text-base font-bold backdrop-blur">
              {slot.label}
              <span className="ml-2 text-sm font-normal text-stone-500">
                {rows.length} shown · {usage.slotBooked[slot.id] ?? 0}/{slot.capacity} booked
              </span>
            </h2>
            {rows.length === 0 ? (
              <p className="px-1 py-2 text-sm text-stone-400">No orders</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((o) => (
                  <OrderRow key={o.id} order={o} now={now} siteUrl={siteUrl} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
