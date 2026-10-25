'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Badge, Button } from './ui';

/**
 * Map with a full list alternative.
 *
 * The list is not a fallback — it is a peer view, reachable by keyboard, and
 * no action exists only on the map. Markers are circles rather than image
 * pins so there is no icon asset to fail to load, and every marker's content
 * is also present in the list.
 */

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  detail?: string;
  tone: 'shelter' | 'hub' | 'need' | 'advisory';
  /** Coverage radius in km, for advisory areas. */
  radiusKm?: number;
  href?: string;
}

const TONE_COLORS: Record<MapPoint['tone'], string> = {
  shelter: '#0f6b66',
  hub: '#17807a',
  need: '#c2560f',
  advisory: '#7c3aed',
};

const TONE_LABELS: Record<MapPoint['tone'], string> = {
  shelter: 'Shelter',
  hub: 'Supply hub',
  need: 'Reported need (area generalised)',
  advisory: 'Advisory area',
};

const LeafletMap = dynamic(() => import('./LeafletMap').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-xl bg-sand-200 text-sm text-ink-500">
      Loading map…
    </div>
  ),
});

export function MapView({
  points,
  center,
  zoom = 12,
  listTitle = 'Everything on this map, as a list',
  height = 420,
}: {
  points: MapPoint[];
  center: { lat: number; lng: number };
  zoom?: number;
  listTitle?: string;
  height?: number;
}) {
  const [showMap, setShowMap] = useState(true);
  const tones = Array.from(new Set(points.map((p) => p.tone)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {tones.map((tone) => (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-700" key={tone}>
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: TONE_COLORS[tone] }}
              />
              {TONE_LABELS[tone]}
            </span>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setShowMap((v) => !v)}>
          {showMap ? 'Hide the map' : 'Show the map'}
        </Button>
      </div>

      {showMap ? (
        <div className="overflow-hidden rounded-xl border border-sand-200" style={{ height }}>
          <LeafletMap center={center} points={points} toneColors={TONE_COLORS} zoom={zoom} />
        </div>
      ) : null}

      <details className="rounded-xl border border-sand-200 bg-white p-4" open={!showMap}>
        <summary className="cursor-pointer font-semibold text-ink-900">{listTitle}</summary>
        {points.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nothing to show here yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {points.map((point) => (
              <li className="border-b border-sand-200 pb-2 last:border-b-0" key={point.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={point.tone === 'need' ? 'attention' : point.tone === 'advisory' ? 'simulated' : 'teal'}>
                    {TONE_LABELS[point.tone]}
                  </Badge>
                  <span className="font-semibold text-ink-900">{point.label}</span>
                </div>
                {point.detail ? <p className="text-sm text-ink-700">{point.detail}</p> : null}
                {point.href ? (
                  <a className="text-sm font-semibold text-teal-700 underline" href={point.href}>
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
