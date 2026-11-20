import { useCallback, useEffect, useState } from 'react';
import { getSetting, setSetting } from './db';
import { TYPE_CHIPS, type TypeChip } from './filter';
import { PRICE_SOURCES, type HeadlineSource, type PriceSource } from './prices';

export const ALL_PRICE_THRESHOLDS = [100, 500, 2000, 5000, 10000]; // cents: $1 $5 $20 $50 $100
export const HIDE_BELOW_OPTIONS = [25, 50, 100, 200, 500]; // cents: $0.25 $0.50 $1 $2 $5

export interface GalleryPrefs {
  showPrice: boolean;
  showColors: boolean;
  showTypes: boolean;
  priceThresholds: number[];
  types: TypeChip[];
  rarityBadges: boolean;
  hideBelowCents: number | null; // always hide cheaper cards (null = off)
  priceSource: HeadlineSource;
  cardPageSources: PriceSource[];
}

export const DEFAULT_PREFS: GalleryPrefs = {
  showPrice: true,
  showColors: true,
  showTypes: true,
  priceThresholds: ALL_PRICE_THRESHOLDS,
  types: TYPE_CHIPS.map((t) => t.key),
  rarityBadges: true,
  hideBelowCents: null,
  priceSource: 'manapool',
  cardPageSources: PRICE_SOURCES.map((s) => s.key),
};

const KEY = 'gallery.prefs';

export function useGalleryPrefs(): [GalleryPrefs, (patch: Partial<GalleryPrefs>) => void] {
  const [prefs, setPrefs] = useState<GalleryPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    getSetting<Partial<GalleryPrefs>>(KEY)
      .then((saved) => saved && setPrefs({ ...DEFAULT_PREFS, ...saved }))
      .catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<GalleryPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      setSetting(KEY, next).catch(() => {});
      return next;
    });
  }, []);

  return [prefs, update];
}
