"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { QtyStepper } from "@/components/QtyStepper";
import { itemsLabel, summarizeCart } from "@/lib/cart";
import { MAX_QTY_PER_ITEM } from "@/lib/config";
import { formatPaise } from "@/lib/format";
import type { Category, MenuItem } from "@/lib/types";

interface Props {
  items: MenuItem[];
  maxAvailable: Partial<Record<Category, number>>;
  ordersOpen: boolean;
}

export function MenuList({ items, maxAvailable, ordersOpen }: Props) {
  const { cart, ready, setQty } = useCart();
  const summary = summarizeCart(cart, items);

  return (
    <>
      <ul className="space-y-3 px-4 pt-4">
        {items.map((item) => {
          const quantity = cart[item.id] ?? 0;
          const categoryLeft = maxAvailable[item.category] ?? 0;
          const inCartForCategory = summary.byCategory[item.category] ?? 0;
          const soldOut = categoryLeft <= 0;
          const canAdd = ordersOpen && !soldOut && quantity < MAX_QTY_PER_ITEM && inCartForCategory < categoryLeft;

          return (
            <li key={item.id} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
              <DishImage item={item} />
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="text-lg font-semibold leading-tight">{item.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-stone-600">{item.description}</p>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-lg font-bold">{formatPaise(item.price_paise)}</span>
                  {soldOut ? (
                    <span className="rounded-lg bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500">
                      Sold out
                    </span>
                  ) : (
                    ready && (
                      <QtyStepper
                        quantity={quantity}
                        canAdd={canAdd}
                        label={item.name}
                        onChange={(q) => setQty(item.id, Math.max(0, q))}
                      />
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {summary.count > 0 && ordersOpen && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <Link
            href="/checkout"
            className="flex h-14 items-center justify-between rounded-2xl bg-brand-600 px-5 text-lg font-bold text-white shadow-lg active:bg-brand-700"
          >
            <span>
              {itemsLabel(summary.count)} · {formatPaise(summary.totalPaise)}
            </span>
            <span>Continue →</span>
          </Link>
        </div>
      )}
    </>
  );
}

function DishImage({ item }: { item: MenuItem }) {
  if (item.image_url) {
    return (
      <Image
        src={item.image_url}
        alt={item.name}
        width={112}
        height={112}
        sizes="112px"
        className="h-28 w-28 shrink-0 rounded-xl object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`flex h-28 w-28 shrink-0 items-center justify-center rounded-xl text-4xl ${
        item.category === "mutton" ? "bg-red-50" : "bg-amber-50"
      }`}
    >
      {item.category === "mutton" ? "🍖" : "🍗"}
    </div>
  );
}
