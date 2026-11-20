import { useSyncExternalStore } from 'react';
import { getSetting, setSetting } from './db';
import { cardsPerPack, isBoxType, packsIn, productPrice, type ProductType, type SealedProduct } from './sealed';
import type { NewSource } from './sources';

export interface Opening {
  product: SealedProduct;
  type: ProductType;
}

const KEY = 'opening';
let current: Opening | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadOpening(): Promise<Opening | null> {
  if (loaded) return current;
  loaded = true;
  try {
    const o = await getSetting<Opening>(KEY);
    if (o && !current) {
      current = o;
      emit();
    }
  } catch {
  }
  return current;
}

export function useOpening(): Opening | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      void loadOpening();
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function getOpening(): Opening | null {
  return current;
}

export function setOpening(o: Opening | null) {
  current = o;
  loaded = true;
  emit();
  setSetting(KEY, o).catch(() => {});
}

export function sourceFromProduct(o: Opening, cardCount: number): NewSource {
  const price = productPrice(o.product);
  const packsNow = Math.max(1, Math.round(cardCount / cardsPerPack(o.type)));
  if (isBoxType(o.type)) {
    const packs = packsIn(o.type);
    return {
      kind: 'box',
      name: o.product.name,
      cost_cents: price,
      packs,
      packs_opened: Math.min(packsNow, packs),
      set_code: o.product.set_code,
      product_id: o.product.product_id || null,
    };
  }
  return {
    kind: 'pack',
    name: packsNow > 1 ? `${o.product.name} ×${packsNow}` : o.product.name,
    cost_cents: price == null ? null : price * packsNow,
    packs: packsNow,
    packs_opened: packsNow,
    set_code: o.product.set_code,
    product_id: o.product.product_id || null,
  };
}
