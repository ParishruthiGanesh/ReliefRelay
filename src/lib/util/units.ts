import { t as translateMessage } from '@/lib/i18n/messages';

/** Thin wrapper so a missing key falls through to the English constants here. */
function translate(
  language: string,
  key: string,
  params: Record<string, string | number> = {},
): string | null {
  const value = translateMessage(language, key, params);
  return value === key ? null : value;
}

/**
 * Units are explicit and never converted. "25 people" is a group size, not 25
 * bottles; litres are never shown as bottles; beds are never shown as people.
 */
export const CATEGORY_UNITS: Record<string, { unit: string; unitLabel: string }> = {
  meal_packs: { unit: 'packs', unitLabel: 'meal packs' },
  drinking_water: { unit: 'litres', unitLabel: 'litres' },
  hygiene_kits: { unit: 'kits', unitLabel: 'hygiene kits' },
  shelter_spaces: { unit: 'spaces', unitLabel: 'shelter spaces' },
};

export const CATEGORY_LABELS: Record<string, string> = {
  meal_packs: 'Meal packs',
  drinking_water: 'Drinking water',
  hygiene_kits: 'Hygiene kits',
  shelter_spaces: 'Shelter spaces',
};

export type CategoryId = keyof typeof CATEGORY_LABELS;

export const CATEGORY_IDS = Object.keys(CATEGORY_LABELS);

export function unitFor(categoryId: string): string {
  const entry = CATEGORY_UNITS[categoryId];
  if (!entry) throw new Error(`Unknown resource category: ${categoryId}`);
  return entry.unit;
}

export function unitLabelFor(categoryId: string): string {
  const entry = CATEGORY_UNITS[categoryId];
  if (!entry) throw new Error(`Unknown resource category: ${categoryId}`);
  return entry.unitLabel;
}

/**
 * The display name of a resource category.
 *
 * Takes a language because this string is read aloud to the person asking for
 * help, not only shown on a coordinator's screen.
 */
export function categoryLabel(categoryId: string, language = 'en'): string {
  const translated = translate(language, `category.${categoryId}`);
  return translated ?? CATEGORY_LABELS[categoryId] ?? categoryId;
}

/**
 * Formats a quantity for display. An unknown quantity reads as unknown — it is
 * never filled in from a group size or any other number.
 */
export function formatQuantity(
  quantity: number | null | undefined,
  categoryId: string,
  uncertain = false,
  language = 'en',
): string {
  const label = translate(language, `unitLabel.${categoryId}`) ?? unitLabelFor(categoryId);
  if (quantity === null || quantity === undefined) {
    return translate(language, 'quantity.unknown', { unitLabel: label })
      ?? `quantity not yet known (${label})`;
  }
  const rounded = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1);
  const key = uncertain ? 'quantity.about' : 'quantity.exact';
  return (
    translate(language, key, { amount: rounded, unitLabel: label })
    ?? (uncertain ? `about ${rounded} ${label} (unconfirmed)` : `${rounded} ${label}`)
  );
}

/** Coarsens a point for public maps: ~1km grid. Exact points stay private. */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
