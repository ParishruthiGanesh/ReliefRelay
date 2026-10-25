import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { getEnvFeedProvider } from '@/lib/providers/envfeed';
import { id, nowIso } from '@/lib/util/ids';
import { distanceKm, freshness } from '@/lib/util/time';

export interface AdvisoryRow {
  id: string;
  external_id: string | null;
  headline: string;
  body: string;
  severity: 'advisory' | 'watch' | 'warning' | 'severe';
  source_name: string;
  source_url: string | null;
  record_kind: 'official' | 'scenario';
  published_at: string;
  expires_at: string | null;
  coverage_label: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  fetched_at: string;
}

export async function refreshAdvisories(db: DB): Promise<{
  inserted: number;
  provider: string;
  recordKind: string;
  error?: string;
}> {
  const provider = getEnvFeedProvider();
  const result = await provider.fetchAdvisories();
  let inserted = 0;

  transact(db, (tx) => {
    const statement = tx.prepare(
      `INSERT INTO advisories (
         id, external_id, headline, body, severity, source_name, source_url,
         record_kind, published_at, expires_at, coverage_label,
         center_lat, center_lng, radius_km, fetched_at
       ) VALUES (@id, @externalId, @headline, @body, @severity, @sourceName, @sourceUrl,
                 @recordKind, @publishedAt, @expiresAt, @coverageLabel,
                 @lat, @lng, @radius, @now)
       ON CONFLICT (source_name, external_id) DO UPDATE SET
         headline = excluded.headline, body = excluded.body,
         severity = excluded.severity, published_at = excluded.published_at,
         expires_at = excluded.expires_at, coverage_label = excluded.coverage_label,
         center_lat = excluded.center_lat, center_lng = excluded.center_lng,
         radius_km = excluded.radius_km, fetched_at = excluded.fetched_at`,
    );
    for (const record of result.records) {
      statement.run({
        id: id('adv'),
        externalId: record.externalId,
        headline: record.headline,
        body: record.body,
        severity: record.severity,
        sourceName: record.sourceName,
        sourceUrl: record.sourceUrl,
        recordKind: result.recordKind,
        publishedAt: record.publishedAt,
        expiresAt: record.expiresAt,
        coverageLabel: record.coverageLabel,
        lat: record.centerLat,
        lng: record.centerLng,
        radius: record.radiusKm,
        now: nowIso(),
      });
      inserted += 1;
    }
  });

  return {
    inserted,
    provider: result.provider.label,
    recordKind: result.recordKind,
    error: result.error,
  };
}

export interface AdvisoryView extends AdvisoryRow {
  status: 'active' | 'expired';
  freshnessLabel: string;
  isSimulated: boolean;
}

export function listAdvisories(db: DB): AdvisoryView[] {
  const rows = db
    .prepare('SELECT * FROM advisories ORDER BY published_at DESC')
    .all() as AdvisoryRow[];
  const now = new Date();
  return rows.map((row) => {
    const state = freshness(row.published_at, { expiresAt: row.expires_at, now, freshMinutes: 120, staleMinutes: 720 });
    return {
      ...row,
      status: state === 'expired' ? 'expired' : 'active',
      freshnessLabel: state,
      isSimulated: row.record_kind === 'scenario',
    };
  });
}

/** Advisories whose circle covers a point. Used to flag requests and facilities. */
export function advisoriesCovering(
  advisories: AdvisoryRow[],
  lat: number,
  lng: number,
  now = new Date(),
): AdvisoryRow[] {
  return advisories.filter((a) => {
    if (a.expires_at && new Date(a.expires_at).getTime() < now.getTime()) return false;
    return distanceKm(lat, lng, a.center_lat, a.center_lng) <= a.radius_km;
  });
}
