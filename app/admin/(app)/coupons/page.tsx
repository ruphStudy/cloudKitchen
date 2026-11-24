import { getAdminClient } from "@/lib/supabase/server";
import { formatInstantIST, formatPaise } from "@/lib/format";
import { ActionForm, Field, inputCls } from "@/components/admin/ActionForm";
import { createCoupon, setCouponActive } from "./actions";

export const dynamic = "force-dynamic";

interface CouponRow {
  id: string;
  code: string;
  kind: "flat" | "percent";
  value: number;
  min_order_paise: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

function couponStatus(c: CouponRow, now: number): { text: string; cls: string } {
  if (!c.is_active) return { text: "Disabled", cls: "bg-stone-200 text-stone-600" };
  if (c.valid_until && now >= Date.parse(c.valid_until)) return { text: "Expired", cls: "bg-stone-200 text-stone-600" };
  if (c.valid_from && now < Date.parse(c.valid_from)) return { text: "Scheduled", cls: "bg-amber-100 text-amber-800" };
  if (c.max_uses !== null && c.used_count >= c.max_uses) return { text: "Used up", cls: "bg-stone-200 text-stone-600" };
  return { text: "Live", cls: "bg-green-100 text-green-800" };
}

export default async function CouponsPage() {
  const { data, error } = await getAdminClient()
    .from("coupons")
    .select("id,code,kind,value,min_order_paise,max_uses,used_count,is_active,valid_from,valid_until")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const coupons = (data ?? []) as CouponRow[];
  const now = Date.now();

  return (
    <main className="space-y-4 px-3 pb-16 pt-4">
      <h1 className="text-xl font-bold">Coupons</h1>

      <details className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <summary className="cursor-pointer text-base font-semibold text-brand-700">+ New coupon</summary>
        <ActionForm action={createCoupon} submitLabel="Create coupon" className="mt-3 space-y-3">
          <Field label="Code">
            <input
              name="code"
              required
              maxLength={20}
              autoCapitalize="characters"
              placeholder="TASTE20"
              className={`${inputCls} uppercase`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select name="kind" defaultValue="flat" className={inputCls}>
                <option value="flat">₹ off</option>
                <option value="percent">% off</option>
              </select>
            </Field>
            <Field label="Amount (₹ or %)">
              <input name="value" required inputMode="decimal" placeholder="20" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min order ₹ (optional)">
              <input name="min_order" inputMode="decimal" placeholder="0" className={inputCls} />
            </Field>
            <Field label="Max uses (optional)">
              <input name="max_uses" type="number" min={1} inputMode="numeric" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <Field label="Valid from (IST, optional)">
              <input name="valid_from" type="datetime-local" className={inputCls} />
            </Field>
            <Field label="Valid until (IST, optional)">
              <input name="valid_until" type="datetime-local" className={inputCls} />
            </Field>
          </div>
          <p className="text-sm text-stone-500">
            A coupon never brings an order below ₹1. Uses are counted only when an order is paid.
          </p>
        </ActionForm>
      </details>

      {coupons.length === 0 && <p className="text-stone-500">No coupons yet.</p>}

      <ul className="space-y-2">
        {coupons.map((c) => {
          const status = couponStatus(c, now);
          return (
            <li key={c.id} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-bold">{c.code}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.text}</span>
                <span className="ml-auto text-base font-semibold">
                  {c.kind === "flat" ? `${formatPaise(c.value)} off` : `${c.value}% off`}
                </span>
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Used {c.used_count}
                {c.max_uses !== null && ` / ${c.max_uses}`}
                {c.min_order_paise > 0 && ` · min ${formatPaise(c.min_order_paise)}`}
                {c.valid_from && ` · from ${formatInstantIST(c.valid_from)}`}
                {c.valid_until && ` · until ${formatInstantIST(c.valid_until)}`}
              </p>
              <ActionForm
                action={setCouponActive}
                submitLabel={c.is_active ? "Disable" : "Enable"}
                pendingLabel="…"
                variant={c.is_active ? "danger" : "quiet"}
              >
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
              </ActionForm>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
