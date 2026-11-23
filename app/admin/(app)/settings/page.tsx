import { listDays, listMenu, listOrders, listSlots, listStock, type AdminDay } from "@/lib/admin-data";
import { computeDayUsage, remainingStock } from "@/lib/availability";
import { CATEGORIES } from "@/lib/config";
import { formatDayShort, formatInstantIST, formatPaise } from "@/lib/format";
import { addDays, istDate, isDayOpen, isoToIstInput } from "@/lib/order-window";
import { ActionForm, Check, Field, inputCls } from "@/components/admin/ActionForm";
import { MenuItemForm } from "@/components/admin/MenuItemForm";
import {
  createDay,
  deleteDay,
  deleteSlot,
  saveMenuItem,
  saveSlot,
  saveStock,
  updateDay,
} from "./actions";

export const dynamic = "force-dynamic";

function windowStatus(day: AdminDay, now: number): { text: string; cls: string } {
  if (!day.is_enabled) return { text: "Off", cls: "bg-stone-200 text-stone-600" };
  if (isDayOpen(day, now)) return { text: "Taking orders", cls: "bg-green-100 text-green-800" };
  if (day.opens_at && now < Date.parse(day.opens_at)) {
    return { text: `Opens ${formatInstantIST(day.opens_at)}`, cls: "bg-amber-100 text-amber-800" };
  }
  return { text: "Closed", cls: "bg-stone-200 text-stone-600" };
}

export default async function SettingsPage() {
  const now = Date.now();
  const today = istDate(now);
  const days = await listDays(addDays(today, -7));
  const dayIds = days.map((d) => d.id);
  const [slots, stock, menu, orders] = await Promise.all([
    listSlots(dayIds),
    listStock(dayIds),
    listMenu(),
    listOrders(dayIds),
  ]);

  return (
    <main className="space-y-6 px-3 pb-16 pt-4">
      {/* ------------------------------------------------------------ Days */}
      <section className="space-y-3">
        <h1 className="text-xl font-bold">Service days</h1>

        <details className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
          <summary className="cursor-pointer text-base font-semibold text-brand-700">+ Add a day</summary>
          <ActionForm action={createDay} submitLabel="Add day" pendingLabel="Adding…" className="mt-3 space-y-3">
            <Field label="Date">
              <input name="date" type="date" required min={today} className={inputCls} />
            </Field>
            <Field label="Label (optional)">
              <input name="label" maxLength={60} placeholder="e.g. Diwali special" className={inputCls} />
            </Field>
            <Check name="is_tasting_day" label="Tasting day" />
            <p className="text-sm text-stone-500">
              Adds slots 12–1, 1–2, 2–3 PM (40 orders each) and stock of 75 mutton + 25 chicken. Orders open 00:00
              on the Friday before and close 21:00 the day before. You can change all of this after adding.
            </p>
          </ActionForm>
        </details>

        {days.length === 0 && <p className="text-stone-500">No days yet.</p>}

        {days.map((day) => {
          const daySlots = slots.filter((s) => s.service_day_id === day.id);
          const dayOrders = orders.filter((o) => o.service_day_id === day.id);
          const usage = computeDayUsage(dayOrders, now);
          const status = windowStatus(day, now);
          const past = day.date < today;

          return (
            <details
              key={day.id}
              open={!past && days.filter((d) => d.date >= today)[0]?.id === day.id}
              className={`rounded-2xl bg-white ring-1 ring-stone-200 ${past ? "opacity-70" : ""}`}
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4">
                <span className="text-base font-bold">{formatDayShort(day.date)}</span>
                {day.label && <span className="text-sm text-stone-600">{day.label}</span>}
                {day.is_tasting_day && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">
                    Tasting
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.text}</span>
              </summary>

              <div className="space-y-5 border-t border-stone-100 p-4">
                {/* Day settings */}
                <ActionForm action={updateDay} submitLabel="Save day" className="space-y-3">
                  <input type="hidden" name="id" value={day.id} />
                  <Field label="Label">
                    <input name="label" defaultValue={day.label ?? ""} maxLength={60} className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                    <Field label="Orders open (IST)">
                      <input
                        name="opens_at"
                        type="datetime-local"
                        defaultValue={isoToIstInput(day.opens_at)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Orders close (IST)">
                      <input
                        name="closes_at"
                        type="datetime-local"
                        defaultValue={isoToIstInput(day.closes_at)}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-x-6">
                    <Check name="is_enabled" label="Enabled" defaultChecked={day.is_enabled} />
                    <Check name="is_tasting_day" label="Tasting day" defaultChecked={day.is_tasting_day} />
                  </div>
                </ActionForm>

                {/* Slots */}
                <div>
                  <h3 className="text-base font-bold">Pickup slots</h3>
                  <p className="text-sm text-stone-500">Capacity = number of orders per slot.</p>
                  <ul className="mt-2 space-y-3">
                    {daySlots.map((slot) => (
                      <li key={slot.id} className="rounded-xl bg-stone-50 p-3">
                        <div className="mb-1 text-sm text-stone-600">
                          <b>{slot.label}</b> · {usage.slotBooked[slot.id] ?? 0}/{slot.capacity} booked
                        </div>
                        <ActionForm action={saveSlot} submitLabel="Save" variant="quiet">
                          <input type="hidden" name="id" value={slot.id} />
                          <input type="hidden" name="service_day_id" value={day.id} />
                          <SlotFields start={slot.start_time} end={slot.end_time} capacity={slot.capacity} />
                          <Check name="is_enabled" label="On" defaultChecked={slot.is_enabled} />
                        </ActionForm>
                        <ActionForm
                          action={deleteSlot}
                          submitLabel="Delete slot"
                          pendingLabel="Deleting…"
                          variant="danger"
                          confirmText={`Delete slot ${slot.label}?`}
                        >
                          <input type="hidden" name="id" value={slot.id} />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Add slot</summary>
                    <ActionForm action={saveSlot} submitLabel="Add slot" className="mt-2">
                      <input type="hidden" name="service_day_id" value={day.id} />
                      <SlotFields start="15:00" end="16:00" capacity={40} />
                    </ActionForm>
                  </details>
                </div>

                {/* Stock */}
                <div>
                  <h3 className="text-base font-bold">Stock</h3>
                  <p className="text-sm text-stone-500">
                    Dishes in the same group share one limit for the day.
                  </p>
                  <div className="mt-2 space-y-3">
                    {CATEGORIES.map((cat) => {
                      const limit = stock.find((s) => s.service_day_id === day.id && s.category === cat)?.stock_limit;
                      const sold = usage.categorySold[cat] ?? 0;
                      const held = usage.categoryHeld[cat] ?? 0;
                      const dishes = menu.filter((m) => m.category === cat);
                      return (
                        <div key={cat} className="rounded-xl bg-stone-50 p-3">
                          <div className="flex items-baseline justify-between">
                            <span className="font-semibold capitalize">{cat}</span>
                            <span className="text-sm tabular-nums">
                              <b>{sold}</b> sold / {limit ?? "—"}
                              {held > 0 && ` · ${held} on hold`}
                              {limit !== undefined && ` · ${remainingStock(limit, sold, held)} left`}
                            </span>
                          </div>
                          <ul className="mt-1 text-sm text-stone-600">
                            {dishes.map((m) => (
                              <li key={m.id} className="flex justify-between">
                                <span>{m.name}</span>
                                <span className="tabular-nums">{usage.dishTotals[m.id] ?? 0}</span>
                              </li>
                            ))}
                          </ul>
                          <ActionForm action={saveStock} submitLabel="Save" variant="quiet">
                            <input type="hidden" name="service_day_id" value={day.id} />
                            <input type="hidden" name="category" value={cat} />
                            <Field label="Limit (bowls)">
                              <input
                                name="stock_limit"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                required
                                defaultValue={limit ?? 0}
                                className={inputCls}
                              />
                            </Field>
                          </ActionForm>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {dayOrders.length === 0 && (
                  <ActionForm
                    action={deleteDay}
                    submitLabel="Delete this day"
                    pendingLabel="Deleting…"
                    variant="danger"
                    confirmText={`Delete ${formatDayShort(day.date)} and its slots?`}
                  >
                    <input type="hidden" name="id" value={day.id} />
                  </ActionForm>
                )}
              </div>
            </details>
          );
        })}
      </section>

      {/* ------------------------------------------------------------ Menu */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Menu</h2>
        <details className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
          <summary className="cursor-pointer text-base font-semibold text-brand-700">+ Add a dish</summary>
          <div className="mt-3">
            <MenuItemForm save={saveMenuItem} />
          </div>
        </details>
        {menu.map((item) => (
          <details key={item.id} className="rounded-2xl bg-white ring-1 ring-stone-200">
            <summary className="flex cursor-pointer items-center justify-between gap-2 p-4">
              <span className={`font-semibold ${item.is_active ? "" : "text-stone-400 line-through"}`}>
                {item.name}
              </span>
              <span className="shrink-0 text-sm text-stone-600">
                {formatPaise(item.price_paise)} · <span className="capitalize">{item.category}</span>
              </span>
            </summary>
            <div className="border-t border-stone-100 p-4">
              <MenuItemForm item={item} save={saveMenuItem} />
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}

function SlotFields({ start, end, capacity }: { start: string; end: string; capacity: number }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Field label="Start">
        <input name="start" type="time" required defaultValue={start.slice(0, 5)} className={inputCls} />
      </Field>
      <Field label="End">
        <input name="end" type="time" required defaultValue={end.slice(0, 5)} className={inputCls} />
      </Field>
      <Field label="Capacity">
        <input
          name="capacity"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={capacity}
          className={inputCls}
        />
      </Field>
    </div>
  );
}
