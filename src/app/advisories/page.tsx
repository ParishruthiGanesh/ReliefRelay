import { getDb } from '@/lib/db';
import { DISTRICT } from '@/lib/db/seed-data';
import { listAdvisories } from '@/lib/domain/advisories';
import { envFeedStatus } from '@/lib/providers/envfeed';
import { Alert, Badge, Card, DefinitionRow, FictionalNotice, SectionHeading } from '@/components/ui';
import { MapView, type MapPoint } from '@/components/MapView';

export const metadata = { title: 'Flood advisories — ReliefRelay' };
export const dynamic = 'force-dynamic';

const SEVERITY_TONE = {
  severe: 'attention',
  warning: 'attention',
  watch: 'warn',
  advisory: 'neutral',
} as const;

export default function AdvisoriesPage() {
  const advisories = listAdvisories(getDb());
  const feed = envFeedStatus();
  const active = advisories.filter((a) => a.status === 'active');
  const expired = advisories.filter((a) => a.status === 'expired');

  const points: MapPoint[] = active.map((advisory) => ({
    id: advisory.id,
    lat: advisory.center_lat,
    lng: advisory.center_lng,
    label: advisory.headline,
    detail: `${advisory.source_name} · ${advisory.coverage_label}`,
    tone: 'advisory',
    radiusKm: advisory.radius_km,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Flood advisories</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          Advisories as published by their source, with the issuing body, when it was published,
          what area it covers and when it expires.
        </p>
      </div>

      <Alert tone={feed.live ? 'info' : 'attention'} title={feed.live ? 'Live feed' : 'Simulated scenario feed'}>
        <p>{feed.note}</p>
        <p className="mt-2">
          ReliefRelay does not forecast flooding. It shows what a source published, and it does not
          attribute any individual flood to a cause. The product supports resilience to flood
          hazards; it does not predict them.
        </p>
      </Alert>

      {points.length > 0 ? (
        <MapView
          center={{ lat: DISTRICT.centerLat, lng: DISTRICT.centerLng }}
          height={360}
          listTitle="Advisory areas, as a list"
          points={points}
        />
      ) : null}

      <section>
        <SectionHeading description="In force now, according to their stated validity.">
          Active advisories
        </SectionHeading>
        {active.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">No active advisories are recorded.</p>
          </Card>
        ) : (
          <ul className="space-y-4">
            {active.map((advisory) => (
              <Card as="li" key={advisory.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[advisory.severity]}>{advisory.severity}</Badge>
                  {advisory.isSimulated ? (
                    <Badge tone="simulated">Simulated record — not from a real source</Badge>
                  ) : (
                    <Badge tone="teal">Official source record</Badge>
                  )}
                </div>
                <h3 className="mt-2 text-lg font-semibold text-ink-900">{advisory.headline}</h3>
                <p className="mt-1 text-[0.95rem] text-ink-700">{advisory.body}</p>
                <dl className="mt-3">
                  <DefinitionRow label="Issued by">{advisory.source_name}</DefinitionRow>
                  <DefinitionRow label="Published">
                    {new Date(advisory.published_at).toLocaleString()}
                  </DefinitionRow>
                  <DefinitionRow label="Coverage">
                    {advisory.coverage_label} (about {advisory.radius_km} km around the stated centre)
                  </DefinitionRow>
                  <DefinitionRow label="Valid until">
                    {advisory.expires_at ? new Date(advisory.expires_at).toLocaleString() : 'not stated'}
                  </DefinitionRow>
                  {advisory.source_url ? (
                    <DefinitionRow label="Original advisory">
                      <a className="text-teal-700 underline" href={advisory.source_url}>
                        Open the source
                      </a>
                    </DefinitionRow>
                  ) : (
                    <DefinitionRow label="Original advisory">
                      <span className="text-ink-500">
                        No link was published with this record.
                      </span>
                    </DefinitionRow>
                  )}
                </dl>
              </Card>
            ))}
          </ul>
        )}
      </section>

      {expired.length > 0 ? (
        <section>
          <SectionHeading description="Kept visible so a withdrawn advisory is not mistaken for a current one.">
            Expired advisories
          </SectionHeading>
          <ul className="space-y-3">
            {expired.map((advisory) => (
              <Card as="li" className="opacity-80" key={advisory.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="attention">Expired</Badge>
                  {advisory.isSimulated ? <Badge tone="simulated">Simulated record</Badge> : null}
                </div>
                <h3 className="mt-2 font-semibold text-ink-900">{advisory.headline}</h3>
                <p className="mt-1 text-sm text-ink-500">
                  {advisory.source_name} · expired{' '}
                  {advisory.expires_at ? new Date(advisory.expires_at).toLocaleString() : 'unknown'}
                </p>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <SectionHeading description="Community reports are kept separate from official advisories, and are never presented as one.">
          Community reports
        </SectionHeading>
        <p className="text-sm text-ink-700">
          What people tell ReliefRelay about their own situation appears as requests and facility
          updates, each carrying its own source and timestamp. Those reports are never merged into
          the advisory list above.
        </p>
      </Card>

      <FictionalNotice />
    </div>
  );
}
