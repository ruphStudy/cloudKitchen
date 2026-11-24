import { getCatalog, maxAvailableByCategory } from "@/lib/catalog";
import { KITCHEN, WHATSAPP_NUMBER } from "@/lib/config";
import { waLink } from "@/lib/whatsapp";
import { weekdayLongOfInstant, weekdayShort } from "@/lib/format";
import { istDate } from "@/lib/order-window";
import { MenuList } from "@/components/MenuList";

export const dynamic = "force-dynamic";

function nextOpenText(nextOpensAt: string | null): string {
  if (!nextOpensAt) return "Next orders open Friday.";
  if (istDate(Date.parse(nextOpensAt)) === istDate()) return "Next orders open later today.";
  return `Next orders open ${weekdayLongOfInstant(nextOpensAt)}.`;
}

export default async function MenuPage() {
  const catalog = await getCatalog();
  const openDays = catalog.days.filter((d) => d.slots.length > 0);
  const maxAvailable = maxAvailableByCategory(catalog.days);
  const ordersOpen = openDays.length > 0;

  const daysLine = ordersOpen
    ? `Orders for ${openDays.map((d) => weekdayShort(d.date)).join(" & ")}`
    : "Orders are closed right now";

  const tastingOnly = ordersOpen && openDays.every((d) => d.isTastingDay);

  return (
    <main className="pb-32">
      <header className="bg-brand-600 px-4 pb-6 pt-8 text-white">
        <h1 className="text-2xl font-bold">{KITCHEN.name}</h1>
        <p className="mt-1 text-base text-brand-100">{KITCHEN.tagline}</p>
        <p className="mt-4 inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{daysLine}</p>
      </header>

      {!ordersOpen && (
        <div className="mx-4 mt-4 rounded-2xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
          <p className="text-base font-semibold">Orders are closed right now. {nextOpenText(catalog.nextOpensAt)}</p>
          {WHATSAPP_NUMBER && (
          <a
            href={waLink(WHATSAPP_NUMBER, KITCHEN.whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex h-12 items-center justify-center rounded-xl bg-[#1fa855] text-base font-bold text-white active:opacity-90"
          >
            Message us on WhatsApp
          </a>
          )}
        </div>
      )}

      {tastingOnly && (
        <p className="mx-4 mt-4 rounded-2xl bg-purple-50 p-4 text-base text-purple-950 ring-1 ring-purple-200">
          <b>Tasting day!</b> One bowl per person. Pick the one you&apos;d like to try.
        </p>
      )}

      <MenuList
        items={catalog.items}
        maxAvailable={maxAvailable}
        ordersOpen={ordersOpen}
        maxTotalItems={tastingOnly ? 1 : undefined}
      />
    </main>
  );
}
