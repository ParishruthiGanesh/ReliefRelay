export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / MINUTE;
}

export function ageMinutes(iso: string, now = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / MINUTE;
}

export type Freshness = 'fresh' | 'ageing' | 'stale' | 'expired';

/**
 * Facility and advisory freshness. Thresholds are deliberately conservative:
 * in a flood an eight-hour-old capacity figure is not something to act on
 * without re-checking, so it is labelled rather than quietly presented as current.
 */
export function freshness(
  updatedAt: string | null | undefined,
  opts: { freshMinutes?: number; staleMinutes?: number; expiresAt?: string | null; now?: Date } = {},
): Freshness {
  const now = opts.now ?? new Date();
  if (opts.expiresAt && new Date(opts.expiresAt).getTime() < now.getTime()) return 'expired';
  if (!updatedAt) return 'stale';
  const age = ageMinutes(updatedAt, now);
  const fresh = opts.freshMinutes ?? 90;
  const stale = opts.staleMinutes ?? 480;
  if (age <= fresh) return 'fresh';
  if (age <= stale) return 'ageing';
  return 'stale';
}

export function formatAge(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round(ageMinutes(iso, now)));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
