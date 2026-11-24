import { listFeedback } from "@/lib/admin-data";
import { aggregateByDish, FEELS, FEEL_LABEL, TASTE_FACES, type FeedbackRow } from "@/lib/feedback";
import { formatDayShort, formatInstantIST } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const feedback = await listFeedback();
  const rows: FeedbackRow[] = feedback
    .filter((f) => f.order)
    .map((f) => ({
      rating: f.rating,
      spice: f.spice,
      quantity_feel: f.quantity_feel,
      comment: f.comment,
      created_at: f.created_at,
      order_no: f.order!.order_no,
      items: f.order!.items,
    }));
  const dishes = aggregateByDish(rows);
  const comments = feedback.filter((f) => f.comment).slice(0, 30);
  const overall = rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null;

  return (
    <main className="space-y-4 px-3 pb-16 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Feedback</h1>
        <a
          href="/api/admin/export/feedback"
          className="flex h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-stone-200"
        >
          ⬇ Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
          <p className="text-xs text-stone-500">Responses</p>
          <p className="mt-1 text-xl font-bold">{rows.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
          <p className="text-xs text-stone-500">Average taste</p>
          <p className="mt-1 text-xl font-bold">{overall ?? "—"} / 5</p>
        </div>
      </div>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h2 className="text-base font-bold">By dish</h2>
        {dishes.length === 0 && <p className="mt-2 text-sm text-stone-500">No feedback yet.</p>}
        <ul className="mt-2 divide-y divide-stone-100">
          {dishes.map((d) => (
            <li key={d.menuItemId} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{d.name}</span>
                <span className="shrink-0 text-lg font-bold tabular-nums">
                  {TASTE_FACES[Math.min(4, Math.max(0, Math.round(d.avgTaste) - 1))]} {d.avgTaste}
                  <span className="text-sm font-normal text-stone-500"> · {d.count}</span>
                </span>
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Spice: {FEELS.map((f) => `${FEEL_LABEL[f]} ${d.spice[f]}`).join(" · ")}
              </p>
              <p className="text-sm text-stone-600">
                Quantity: {FEELS.map((f) => `${FEEL_LABEL[f]} ${d.quantity[f]}`).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold">Latest comments</h2>
        {comments.length === 0 && <p className="text-sm text-stone-500">No comments yet.</p>}
        {comments.map((f) => (
          <article key={f.id} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
              <span className="text-xl">{TASTE_FACES[f.rating - 1]}</span>
              <span className="font-semibold text-stone-800">{f.order?.order_no}</span>
              <span>{f.order?.customer_name}</span>
              {f.order?.service_days && <span>· {formatDayShort(f.order.service_days.date)}</span>}
              <span className="ml-auto">{formatInstantIST(f.created_at)}</span>
            </div>
            <p className="mt-1 text-sm text-stone-600">{f.order?.items.map((i) => i.name).join(", ")}</p>
            <p className="mt-2 whitespace-pre-line text-base">{f.comment}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
