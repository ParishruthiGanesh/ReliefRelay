import { getDb } from '@/lib/db';
import { DISTRICT } from '@/lib/db/seed-data';
import { listFacilities, ACCESSIBILITY_LABELS } from '@/lib/domain/facilities';
import { publicNeedSummaries } from '@/lib/domain/dashboard';
import { listAdvisories } from '@/lib/domain/advisories';
import { categoryLabel } from '@/lib/util/units';
import { Alert, Badge, Card, FictionalNotice, Provenance, SectionHeading } from '@/components/ui';
import { MapView, type MapPoint } from '@/components/MapView';

export const metadata = { title: 'Find supplies or shelter — ReliefRelay' };
export const dynamic = 'force-dynamic';

const AVAILABILITY_COPY: Record<string, { label: string; tone: 'good' | 'neutral' | 'attention'; note: string }> = {
  recently_confirmed: {
    label: 'Recently confirmed',
    tone: 'good',
    note: 'The facility confirmed this figure within the last 90 minutes.',
  },
  reported: {
    label: 'Reported',
    tone: 'neutral',
    note: 'This figure was reported a few hours ago and may have changed.',
  },
  stale: {
    label: 'Stale — check before travelling',
    tone: 'attention',
    note: 'Nobody has confirmed this figure for more than eight hours. Treat it as out of date.',
  },
  full: { label: 'Full', tone: 'attention', note: 'The facility reports no spaces left.' },
  closed: { label: 'Closed', tone: 'attention', note: 'The facility reports it is closed.' },
};

export default function FindPage() {
  const db = getDb();
  const facilities = listFacilities(db);
  const needs = publicNeedSummaries(db);
  const advisories = listAdvisories(db).filter((a) => a.status === 'active');

  const points: MapPoint[] = [
    ...advisories.map((advisory) => ({
      id: `adv-${advisory.id}`,
      lat: advisory.center_lat,
      lng: advisory.center_lng,
      label: advisory.headline,
      detail: `${advisory.source_name}${advisory.isSimulated ? ' — SIMULATED record' : ''} · ${advisory.coverage_label}`,
      tone: 'advisory' as const,
      radiusKm: advisory.radius_km,
    })),
    ...facilities.map((facility) => ({
      id: facility.id,
      lat: facility.lat,
      lng: facility.lng,
      label: facility.name,
      detail:
        facility.kind === 'shelter'
          ? `Shelter · ${facility.capacityAvailable ?? 'unknown'} spaces reported · updated ${facility.lastUpdateAge}`
          : `Supply hub · updated ${facility.lastUpdateAge}`,
      tone: facility.kind === 'shelter' ? ('shelter' as const) : ('hub' as const),
    })),
    ...needs
      .filter((need) => need.publicLat !== null && need.publicLng !== null && need.hasUnmetNeed)
      .map((need) => ({
        id: `need-${need.referenceCode}`,
        lat: need.publicLat!,
        lng: need.publicLng!,
        label: `Unmet need: ${need.categories.join(', ')}`,
        detail: `${need.areaLabel} · reported ${need.createdAge} · location generalised`,
        tone: 'need' as const,
      })),
  ];

  const shelters = facilities.filter((f) => f.kind === 'shelter');
  const hubs = facilities.filter((f) => f.kind === 'supply_hub');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Find supplies or shelter</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          Shelters and supply hubs in the district, each with the time its figures were last
          confirmed and who confirmed them.
        </p>
      </div>

      <Alert tone="attention" title="Finding a shelter here does not reserve a place">
        Capacity figures are reports with a timestamp, not live bookings. Spaces can be taken
        between the last update and your arrival. Call the shelter before travelling if you can.
      </Alert>

      <MapView
        center={{ lat: DISTRICT.centerLat, lng: DISTRICT.centerLng }}
        listTitle="Everything on this map, as a list"
        points={points}
      />

      <section>
        <SectionHeading
          description="Reported available spaces, with how recently each figure was confirmed."
          id="shelters"
        >
          Shelters
        </SectionHeading>
        <ul className="grid gap-4 sm:grid-cols-2">
          {shelters.map((facility) => {
            const copy = AVAILABILITY_COPY[facility.availabilityLabel];
            return (
              <Card as="li" key={facility.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-ink-900">{facility.name}</h3>
                  <Badge tone={copy.tone}>{copy.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-700">{facility.address}</p>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="font-semibold text-ink-700">Spaces reported</dt>
                    <dd>
                      {facility.capacityAvailable ?? 'not stated'}
                      {facility.capacityTotal ? ` of ${facility.capacityTotal}` : ''}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-semibold text-ink-700">Opening status</dt>
                    <dd>{facility.openingStatus}</dd>
                  </div>
                  {facility.resourceCategories.length > 0 ? (
                    <div className="flex gap-2">
                      <dt className="font-semibold text-ink-700">Supplies on site</dt>
                      <dd>{facility.resourceCategories.map(categoryLabel).join(', ')}</dd>
                    </div>
                  ) : null}
                  {facility.resourcesNote ? (
                    <div className="flex gap-2">
                      <dt className="font-semibold text-ink-700">Note</dt>
                      <dd>{facility.resourcesNote}</dd>
                    </div>
                  ) : null}
                  {facility.publicContact ? (
                    <div className="flex gap-2">
                      <dt className="font-semibold text-ink-700">Contact</dt>
                      <dd>{facility.publicContact}</dd>
                    </div>
                  ) : null}
                </dl>
                {facility.accessibility.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {facility.accessibility.map((feature) => (
                      <Badge key={feature} tone="teal">
                        {ACCESSIBILITY_LABELS[feature] ?? feature}
                      </Badge>
                    ))}
                  </p>
                ) : null}
                <p className="mt-3">
                  <Provenance
                    age={facility.lastUpdateAge}
                    freshness={facility.freshness}
                    sourceLabel={
                      facility.lastUpdateSource === 'facility_confirmed'
                        ? 'Facility confirmed'
                        : facility.lastUpdateSource === 'coordinator_reviewed'
                          ? 'Coordinator reviewed'
                          : 'User reported'
                    }
                  />
                </p>
                <p className="mt-2 text-xs text-ink-500">{copy.note}</p>
              </Card>
            );
          })}
        </ul>
      </section>

      <section>
        <SectionHeading description="Where organisations collect from and dispatch supplies.">
          Supply hubs
        </SectionHeading>
        <ul className="grid gap-4 sm:grid-cols-2">
          {hubs.map((facility) => (
            <Card as="li" key={facility.id}>
              <h3 className="text-lg font-semibold text-ink-900">{facility.name}</h3>
              <p className="mt-1 text-sm text-ink-700">{facility.address}</p>
              {facility.resourceCategories.length > 0 ? (
                <p className="mt-2 text-sm">
                  <span className="font-semibold text-ink-700">Uncommitted stock in: </span>
                  {facility.resourceCategories.map(categoryLabel).join(', ')}
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-500">No uncommitted stock recorded here.</p>
              )}
              {facility.publicContact ? (
                <p className="mt-2 text-sm">{facility.publicContact}</p>
              ) : null}
              <p className="mt-3">
                <Provenance
                  age={facility.lastUpdateAge}
                  freshness={facility.freshness}
                  sourceLabel="Facility confirmed"
                />
              </p>
            </Card>
          ))}
        </ul>
      </section>

      <Card>
        <SectionHeading description="Generalised to roughly a one-kilometre grid. Exact locations, contact details and quantities are visible only to authorised coordinators.">
          Where help has been asked for
        </SectionHeading>
        {needs.length === 0 ? (
          <p className="text-sm text-ink-500">No requests have been recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {needs.slice(0, 20).map((need) => (
              <li className="flex flex-wrap items-center gap-2 border-b border-sand-200 py-2 last:border-b-0" key={need.referenceCode}>
                <Badge tone={need.hasUnmetNeed ? 'attention' : 'good'}>
                  {need.hasUnmetNeed ? 'Still unmet' : 'Covered'}
                </Badge>
                <span className="font-semibold text-ink-900">{need.categories.join(', ')}</span>
                <span className="text-sm text-ink-500">
                  {need.areaLabel} · {need.statusLabel} · reported {need.createdAge}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FictionalNotice />
    </div>
  );
}
