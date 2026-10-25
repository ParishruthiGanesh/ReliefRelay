import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { DISTRICT } from '@/lib/db/seed-data';
import { CoordinatorDashboard } from '@/components/CoordinatorDashboard';
import { Card, FictionalNotice } from '@/components/ui';

export const metadata = { title: 'Coordinator dashboard — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default async function CoordinatorPage() {
  const user = await currentUser();
  if (!user || user.role !== 'coordinator') redirect('/login');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Coordinator dashboard</h1>
          <p className="mt-1 text-ink-700">
            Signed in as {user.displayName}. {DISTRICT.name}.
          </p>
        </div>
        <nav aria-label="Coordinator sections" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link className="font-semibold text-teal-700 underline" href="/coordinator/inventory">
            Stock &amp; attestations
          </Link>
          <Link className="font-semibold text-teal-700 underline" href="/coordinator/duplicates">
            Possible duplicates
          </Link>
          <Link className="font-semibold text-teal-700 underline" href="/coordinator/metrics">
            Metrics
          </Link>
        </nav>
      </div>

      <CoordinatorDashboard center={{ lat: DISTRICT.centerLat, lng: DISTRICT.centerLng }} />

      <Card>
        <p className="text-sm text-ink-700">
          Requested, committed and received quantities are kept as three separate figures
          throughout. A commitment is a promise; only a confirmed receipt reduces need for good,
          and a short delivery puts the difference straight back into the unmet column.
        </p>
      </Card>

      <FictionalNotice />
    </div>
  );
}
