"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Cart } from "@/lib/types";

const CART_KEY = "ck_cart_v1";

interface CartContextValue {
  cart: Cart;
  /** False until the cart has been read from localStorage. */
  ready: boolean;
  setQty: (menuItemId: string, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function readCart(): Cart {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const cart: Cart = {};
    for (const [id, q] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof q === "number" && Number.isInteger(q) && q > 0) cart[id] = q;
    }
    return cart;
  } catch {
    return {};
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCart(readCart());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // Storage may be unavailable (private mode); the cart still works in memory.
    }
  }, [cart, ready]);

  const setQty = useCallback((menuItemId: string, quantity: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity > 0) next[menuItemId] = quantity;
      else delete next[menuItemId];
      return next;
    });
  }, []);

  const clear = useCallback(() => setCart({}), []);

  const value = useMemo(() => ({ cart, ready, setQty, clear }), [cart, ready, setQty, clear]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
