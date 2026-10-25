import type { DB } from '@/lib/db';
import type { LocationCandidate } from '@/lib/validation/schemas';

/**
 * Turns location text into *candidates* the user chooses from.
 *
 * It never invents coordinates. "The school near the old bridge" matches two
 * known facilities and produces two candidates, not a guessed point. Only an
 * unambiguous match against a facility name resolves on its own, and even then
 * the resolution is shown back to the user before submission.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'in', 'on', 'near', 'by', 'next', 'to', 'of', 'we', 'are',
  'is', 'and', 'our', 'my', 'from', 'here', 'there', 'close', 'beside', 'around',
  'i', 'am', 'it', 'this', 'that', 'place', 'old',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface FacilityRow {
  id: string;
  name: string;
  kind: 'shelter' | 'supply_hub';
  lat: number;
  lng: number;
}

export interface LocationMatchResult {
  candidates: LocationCandidate[];
  /** Set only when exactly one facility name matches unambiguously. */
  resolved: LocationCandidate | null;
}

export function matchLocation(db: DB, text: string): LocationMatchResult {
  const query = tokens(text);
  if (query.length === 0) return { candidates: [], resolved: null };

  const facilities = db
    .prepare('SELECT id, name, kind, lat, lng FROM facilities ORDER BY name')
    .all() as FacilityRow[];

  const scored = facilities
    .map((facility) => {
      const nameTokens = tokens(facility.name);
      const overlap = query.filter((q) => nameTokens.includes(q));
      // A full, exact name match is a much stronger signal than shared words.
      const normalizedName = facility.name.toLowerCase().replace(/\s*\(fictional\)\s*/, '').trim();
      const exact = text.toLowerCase().includes(normalizedName);
      const score = (exact ? 10 : 0) + overlap.length;
      return {
        facility,
        score,
        exact,
        matchedOn: overlap.join(' ') || (exact ? normalizedName : ''),
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const candidates: LocationCandidate[] = scored.slice(0, 5).map((row) => ({
    facilityId: row.facility.id,
    label: row.facility.name,
    lat: row.facility.lat,
    lng: row.facility.lng,
    kind: row.facility.kind,
    matchedOn: row.matchedOn || undefined,
  }));

  const exactMatches = scored.filter((row) => row.exact);
  const resolved =
    exactMatches.length === 1
      ? (candidates.find((c) => c.facilityId === exactMatches[0].facility.id) ?? null)
      : null;

  return { candidates, resolved };
}
