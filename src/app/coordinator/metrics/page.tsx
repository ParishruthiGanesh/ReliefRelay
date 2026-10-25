import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { getDb } from '@/lib/db';
import { metricsSnapshot, PRIORITY_FACTOR_LABELS } from '@/lib/domain/metrics';
import { categoryLabel } from '@/lib/util/units';
import { Alert, Badge, Card, DefinitionRow, FictionalNotice, SectionHeading } from '@/components/ui';

export const metadata = { title: 'Metrics — ReliefRelay' };
export const dynamic = 'force-dynamic';

function minutes(value: number | null): string {
  if (value === null) return 'nothing has reached this stage yet';
  if (value < 60) return `${value} min`;
  return `${(value / 60).toFixed(1)} h`;
}

export default async function MetricsPage() {
  const user = await currentUser();
  if (!user || user.role !== 'coordinator') redirect('/login');

  const metrics = metricsSnapshot(getDb());

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-semibold text-teal-700 underline" href="/coordinator">
          ← Back to the dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink-900">Operational metrics</h1>
      </div>

      <Alert tone="info" title="What these numbers are, and are not">
        Every figure is computed from records in this database. There are no estimates of lives
        saved, emissions avoided, or beneficiaries verified — this prototype has no way to measure
        those, and putting an invented number beside a real one would devalue both. All underlying
        data is fictional.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionHeading description={metrics.timeToReview.note}>
            {metrics.timeToReview.label}
          </SectionHeading>
          <p className="text-3xl font-semibold text-ink-900">
            {minutes(metrics.timeToReview.medianMinutes)}
          </p>
          <p className="text-sm text-ink-500">
            median · mean {minutes(metrics.timeToReview.meanMinutes)} · {metrics.timeToReview.count}{' '}
            requests reviewed
          </p>
        </Card>
        <Card>
          <SectionHeading description={metrics.timeToFirstAllocation.note}>
            {metrics.timeToFirstAllocation.label}
          </SectionHeading>
          <p className="text-3xl font-semibold text-ink-900">
            {minutes(metrics.timeToFirstAllocation.medianMinutes)}
          </p>
          <p className="text-sm text-ink-500">
            median · mean {minutes(metrics.timeToFirstAllocation.meanMinutes)} ·{' '}
            {metrics.timeToFirstAllocation.count} requests allocated
          </p>
        </Card>
      </div>

      <Card>
        <SectionHeading description="Requested, committed, received and outstanding by category — four separate figures, each in its own unit.">
          Quantities by category
        </SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-1" scope="col">Category</th>
                <th className="py-1" scope="col">Unit</th>
                <th className="py-1" scope="col">Requested</th>
                <th className="py-1" scope="col">Committed</th>
                <th className="py-1" scope="col">Received</th>
                <th className="py-1" scope="col">Outstanding</th>
                <th className="py-1" scope="col">Shortfall</th>
                <th className="py-1" scope="col">Amount unknown</th>
              </tr>
            </thead>
            <tbody>
              {metrics.categoryTotals.map((row) => (
                <tr className="border-t border-sand-200" key={row.categoryId}>
                  <th className="py-2 pr-2 text-left font-semibold" scope="row">
                    {categoryLabel(row.categoryId)}
                  </th>
                  <td>{row.unitLabel}</td>
                  <td>{row.requested}</td>
                  <td>{row.committed}</td>
                  <td>{row.received}</td>
                  <td className="font-semibold">{row.outstanding}</td>
                  <td className="text-ember-700">{row.shortfall}</td>
                  <td>
                    {row.requestedUnknownItems > 0 ? (
                      <Badge tone="warn">{row.requestedUnknownItems} items</Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          &ldquo;Amount unknown&rdquo; counts request items where nobody has yet given a quantity.
          They are never counted as zero and never estimated from a group size.
        </p>
      </Card>

      <Card>
        <SectionHeading>Delivery</SectionHeading>
        <dl>
          <DefinitionRow label="Commitments">{metrics.delivery.commitmentsTotal}</DefinitionRow>
          <DefinitionRow label="Cancelled">{metrics.delivery.commitmentsCancelled}</DefinitionRow>
          <DefinitionRow label="Reassigned">{metrics.delivery.commitmentsReassigned}</DefinitionRow>
          <DefinitionRow label="Dispatches recorded">{metrics.delivery.dispatches}</DefinitionRow>
          <DefinitionRow label="Receipts confirmed">{metrics.delivery.receiptsConfirmed}</DefinitionRow>
          <DefinitionRow label="Short deliveries">{metrics.delivery.deliveriesShort}</DefinitionRow>
          <DefinitionRow label="Failed deliveries (nothing arrived)">
            {metrics.delivery.deliveriesFailed}
          </DefinitionRow>
          <DefinitionRow label="Completion rate">
            {metrics.delivery.completionRatePercent === null
              ? 'no commitment has settled yet'
              : `${metrics.delivery.completionRatePercent}%`}
            <span className="block text-xs text-ink-500">{metrics.delivery.completionRateNote}</span>
          </DefinitionRow>
        </dl>
      </Card>

      <Card>
        <SectionHeading description="How old each facility's last confirmation is. An old figure is not a current one.">
          Age of facility updates
        </SectionHeading>
        <ul className="space-y-1 text-sm">
          {metrics.facilityUpdateAges.map((facility) => (
            <li className="flex justify-between border-b border-sand-200 py-1 last:border-b-0" key={facility.facilityId}>
              <span>{facility.name}</span>
              <span className={facility.ageMinutes !== null && facility.ageMinutes > 480 ? 'font-semibold text-ember-700' : 'text-ink-700'}>
                {facility.ageMinutes === null
                  ? 'never updated'
                  : facility.ageMinutes < 60
                    ? `${facility.ageMinutes} min ago`
                    : `${(facility.ageMinutes / 60).toFixed(1)} h ago`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeading description="The complete list. Nothing else influences the ordering of requests.">
          Prioritisation factors
        </SectionHeading>
        <ul className="space-y-1 text-sm">
          {Object.values(PRIORITY_FACTOR_LABELS).map((label) => (
            <li key={label}>• {label}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-700">
          Deliberately excluded: how fluently someone writes or speaks, which language they used,
          what device they have, and whether they can produce identification. None of those
          indicate need, and using them would push help away from the people most likely to need
          it.
        </p>
      </Card>

      <Card>
        <SectionHeading>Requests missing essential information</SectionHeading>
        <p className="text-3xl font-semibold text-ink-900">{metrics.requestsMissingInformation}</p>
        <p className="text-sm text-ink-500">
          These can still be submitted and worked on — someone who cannot answer more questions is
          not turned away. The gaps are simply made visible.
        </p>
      </Card>

      <FictionalNotice />
    </div>
  );
}
