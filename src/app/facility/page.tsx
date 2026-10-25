import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { getDb } from '@/lib/db';
import { facilityUpdateHistory } from '@/lib/domain/facilities';
import { FacilityUpdatePanel } from '@/components/FacilityUpdatePanel';
import { Alert, Card, FictionalNotice, SectionHeading } from '@/components/ui';

export const metadata = { title: 'Facility update — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default async function FacilityPage() {
  const user = await currentUser();
  if (!user || (user.role !== 'facility_rep' && user.role !== 'coordinator')) redirect('/login');
  if (!user.facilityId) {
    return (
      <Alert tone="attention" title="No facility is registered on this account">
        A facility representative account must be linked to one facility. Coordinators update
        facilities from the dashboard instead.
      </Alert>
    );
  }

  const history = facilityUpdateHistory(getDb(), user.facilityId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Update your facility</h1>
        <p className="mt-1 text-ink-700">Signed in as {user.displayName}.</p>
      </div>

      <FacilityUpdatePanel facilityId={user.facilityId} />

      <Card>
        <SectionHeading description="Every update is kept, so the directory can always say who confirmed a figure and when.">
          Update history
        </SectionHeading>
        <ol className="space-y-2 text-sm">
          {history.map((entry) => (
            <li className="border-b border-sand-200 pb-2 last:border-b-0" key={entry.id}>
              <span className="font-semibold text-ink-900">
                {entry.capacity_available ?? '—'} spaces
                {entry.opening_status ? ` · ${entry.opening_status}` : ''}
              </span>
              <span className="ml-2 text-ink-500">
                {new Date(entry.created_at).toLocaleString()} ·{' '}
                {entry.reporter_name ?? entry.source_kind.replace('_', ' ')}
              </span>
              {entry.resources_note ? (
                <span className="block text-ink-700">{entry.resources_note}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>

      <FictionalNotice />
    </div>
  );
}
