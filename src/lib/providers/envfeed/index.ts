import { SCENARIO_ADVISORIES } from '@/lib/db/seed-data';
import type {
  AdvisoryRecord,
  EnvFeedProvider,
  EnvFeedResult,
  ProviderInfo,
} from '../types';

/**
 * Environmental / flood advisory feed.
 *
 * Two adapters behind one interface. The `geojson` adapter fetches advisories
 * published by a real source; the `scenario` adapter returns the demonstration
 * district's simulated advisories. They are stored with different
 * `record_kind` values and rendered with different badges, and the two are
 * never merged into one list.
 *
 * This is sourced information, not a forecast. Nothing in ReliefRelay predicts
 * flooding, and the UI does not claim otherwise.
 */

const SEVERITIES = new Set(['advisory', 'watch', 'warning', 'severe']);

function coerceSeverity(value: unknown): AdvisoryRecord['severity'] {
  const text = String(value ?? '').toLowerCase();
  if (SEVERITIES.has(text)) return text as AdvisoryRecord['severity'];
  // Common CAP vocabulary mapped conservatively: an unknown value is never
  // promoted to a higher severity than we can justify.
  if (text === 'extreme') return 'severe';
  if (text === 'moderate') return 'watch';
  if (text === 'minor' || text === 'unknown') return 'advisory';
  return 'advisory';
}

interface GeoJsonFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/**
 * Reads a GeoJSON FeatureCollection of advisories.
 *
 * Expected per-feature properties (all optional except `headline`):
 *   id, headline, description, severity, source, url, published, expires,
 *   coverage, radius_km
 * Point geometry is used for the centre. Anything missing is reported as
 * missing rather than filled in with a plausible value.
 */
export class GeoJsonEnvFeedProvider implements EnvFeedProvider {
  readonly recordKind = 'official' as const;
  readonly info: ProviderInfo;

  constructor(
    private url: string,
    sourceName = process.env.ENV_FEED_SOURCE_NAME ?? 'Configured environmental feed',
  ) {
    this.info = {
      id: 'geojson-env-feed',
      label: `${sourceName} (GeoJSON feed)`,
      kind: 'live_service',
    };
  }

  async fetchAdvisories(): Promise<EnvFeedResult> {
    try {
      const response = await fetch(this.url, {
        headers: { accept: 'application/geo+json, application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const body = (await response.json()) as { features?: GeoJsonFeature[] };
      const features = Array.isArray(body.features) ? body.features : [];
      const sourceName = process.env.ENV_FEED_SOURCE_NAME ?? 'Configured environmental feed';

      const records: AdvisoryRecord[] = [];
      for (const [index, feature] of features.entries()) {
        const props = feature.properties ?? {};
        const headline = typeof props.headline === 'string' ? props.headline : null;
        if (!headline) continue;
        const coords = feature.geometry?.coordinates;
        const point = Array.isArray(coords) && typeof coords[0] === 'number' ? coords : null;
        records.push({
          externalId: String(props.id ?? `${this.url}#${index}`),
          headline,
          body: typeof props.description === 'string' ? props.description : headline,
          severity: coerceSeverity(props.severity),
          sourceName: typeof props.source === 'string' ? props.source : sourceName,
          sourceUrl:
            typeof props.url === 'string'
              ? props.url
              : (process.env.ENV_FEED_ATTRIBUTION_URL ?? null),
          publishedAt:
            typeof props.published === 'string'
              ? new Date(props.published).toISOString()
              : new Date().toISOString(),
          expiresAt: typeof props.expires === 'string' ? new Date(props.expires).toISOString() : null,
          coverageLabel:
            typeof props.coverage === 'string' ? props.coverage : 'Coverage not stated by the source',
          centerLat: point ? Number(point[1]) : 0,
          centerLng: point ? Number(point[0]) : 0,
          radiusKm: typeof props.radius_km === 'number' ? props.radius_km : 10,
        });
      }
      return { records, provider: this.info, recordKind: 'official' };
    } catch (error) {
      // A feed that cannot be reached produces no records and says why. It never
      // silently falls back to simulated data presented as official.
      return {
        records: [],
        provider: this.info,
        recordKind: 'official',
        error: `The configured environmental feed could not be read: ${(error as Error).message}`,
      };
    }
  }
}

export class ScenarioEnvFeedProvider implements EnvFeedProvider {
  readonly recordKind = 'scenario' as const;
  readonly info: ProviderInfo = {
    id: 'scenario-feed',
    label: 'Simulated scenario feed for the fictional Riverbend District',
    kind: 'fixture',
  };

  async fetchAdvisories(): Promise<EnvFeedResult> {
    const now = Date.now();
    const records: AdvisoryRecord[] = SCENARIO_ADVISORIES.map((a) => ({
      externalId: a.externalId,
      headline: a.headline,
      body: a.body,
      severity: a.severity,
      sourceName: a.sourceName,
      sourceUrl: a.sourceUrl,
      publishedAt: new Date(now + a.publishedOffsetMinutes * 60_000).toISOString(),
      expiresAt: new Date(now + a.expiresOffsetMinutes * 60_000).toISOString(),
      coverageLabel: a.coverageLabel,
      centerLat: a.centerLat,
      centerLng: a.centerLng,
      radiusKm: a.radiusKm,
    }));
    return { records, provider: this.info, recordKind: 'scenario' };
  }
}

export function getEnvFeedProvider(): EnvFeedProvider {
  const configured = (process.env.ENV_FEED_PROVIDER ?? 'scenario').toLowerCase();
  const url = process.env.ENV_FEED_URL;
  if (configured === 'geojson' && url) return new GeoJsonEnvFeedProvider(url);
  return new ScenarioEnvFeedProvider();
}

export function envFeedStatus(): {
  configured: string;
  active: string;
  live: boolean;
  recordKind: 'official' | 'scenario';
  note: string;
} {
  const configured = (process.env.ENV_FEED_PROVIDER ?? 'scenario').toLowerCase();
  const url = process.env.ENV_FEED_URL;
  if (configured === 'geojson' && url) {
    return {
      configured,
      active: 'geojson-env-feed',
      live: true,
      recordKind: 'official',
      note: `Advisories are fetched from ${url} and shown with the issuing source, publication time, coverage and expiry. ReliefRelay does not forecast flooding; it displays what the source published.`,
    };
  }
  return {
    configured: 'scenario',
    active: 'scenario-feed',
    live: false,
    recordKind: 'scenario',
    note: 'A simulated scenario feed is active for the fictional demonstration district. Every record is badged as simulated and is never mixed with records from a real source. Set ENV_FEED_PROVIDER=geojson and ENV_FEED_URL to read a real feed.',
  };
}
