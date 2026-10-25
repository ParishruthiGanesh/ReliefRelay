import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { getDb } from '@/lib/db';
import { listInventory, listOffers } from '@/lib/domain/inventory';
import { listFacilities } from '@/lib/domain/facilities';
import { chainStatus } from '@/lib/providers/chain';
import { categoryLabel } from '@/lib/util/units';
import { Alert, Badge, Card, DefinitionRow, FictionalNotice, Provenance, SectionHeading } from '@/components/ui';
import { AttestationFlushButton } from '@/components/AttestationFlushButton';

export const metadata = { title: 'Stock and attestations — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const user = await currentUser();
  if (!user || user.role !== 'coordinator') redirect('/login');

  const db = getDb();
  const inventory = listInventory(db);
  const offers = listOffers(db);
  const facilities = listFacilities(db);
  const chain = await chainStatus();

  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM attestations GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-semibold text-teal-700 underline" href="/coordinator">
          ← Back to the dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink-900">Stock and attestations</h1>
      </div>

      <Card>
        <SectionHeading description="Total, committed and uncommitted are separate figures. Committing stock reduces what is uncommitted immediately and atomically, so the same pallets cannot be promised twice.">
          Recorded stock
        </SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-1" scope="col">Organisation</th>
                <th className="py-1" scope="col">Category</th>
                <th className="py-1" scope="col">Total</th>
                <th className="py-1" scope="col">Committed</th>
                <th className="py-1" scope="col">Uncommitted</th>
                <th className="py-1" scope="col">Where</th>
                <th className="py-1" scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((lot) => (
                <tr className="border-t border-sand-200" key={lot.id}>
                  <th className="py-2 pr-2 text-left font-semibold" scope="row">
                    {lot.organizationName}
                  </th>
                  <td>{categoryLabel(lot.categoryId)}</td>
                  <td>
                    {lot.qtyTotal} {lot.unit}
                  </td>
                  <td>
                    {lot.qtyCommitted} {lot.unit}
                  </td>
                  <td className="font-semibold">
                    {lot.qtyAvailable} {lot.unit}
                  </td>
                  <td>
                    {lot.generalLocation}
                    <span className="block text-xs text-ink-500">{lot.handover}</span>
                  </td>
                  <td className="text-xs text-ink-500">
                    {[lot.storageNote, lot.expiryNote].filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionHeading description="An offer is not stock. It becomes allocatable only when a coordinator accepts it.">
          Offers awaiting review ({offers.length})
        </SectionHeading>
        {offers.length === 0 ? (
          <p className="text-sm text-ink-500">No offers are waiting.</p>
        ) : (
          <ul className="space-y-2">
            {offers.map((offer) => (
              <li className="rounded-xl border border-sand-200 p-3 text-sm" key={offer.id}>
                <strong>
                  {offer.qty} {offer.unit} of {categoryLabel(offer.category_id).toLowerCase()}
                </strong>{' '}
                from {offer.org_name ?? offer.contact_name ?? 'an unaffiliated donor'} at{' '}
                {offer.general_location}
                <span className="block text-xs text-ink-500">
                  {offer.handover}
                  {offer.available_until ? ` · until ${offer.available_until}` : ''}
                  {offer.expiry_note ? ` · ${offer.expiry_note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeading description="Capacity figures with the time each was last confirmed and by whom.">
          Facility capacity
        </SectionHeading>
        <ul className="space-y-2">
          {facilities.map((facility) => (
            <li className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 py-2 last:border-b-0" key={facility.id}>
              <span>
                <strong>{facility.name}</strong>
                <span className="ml-2 text-sm text-ink-700">
                  {facility.kind === 'shelter'
                    ? `${facility.capacityAvailable ?? '?'} of ${facility.capacityTotal ?? '?'} spaces · ${facility.openingStatus}`
                    : 'supply hub'}
                </span>
              </span>
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
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeading description="Acknowledgements are written to the database first and pushed to the chain afterwards, so chain downtime never blocks relief work.">
          Blockchain attestations
        </SectionHeading>
        <Alert tone={chain.enabled && chain.reachable ? 'good' : 'attention'}>
          <p>{chain.note}</p>
          {chain.enabled && chain.reachable ? (
            <dl className="mt-2">
              <DefinitionRow label="Chain">{chain.chainId}</DefinitionRow>
              <DefinitionRow label="Contract">
                <span className="break-all font-mono text-xs">{chain.contractAddress}</span>
              </DefinitionRow>
              <DefinitionRow label="Attester">
                <span className="break-all font-mono text-xs">{chain.attesterAddress}</span>{' '}
                {chain.attesterRegistered ? (
                  <Badge tone="good">registered</Badge>
                ) : (
                  <Badge tone="attention">not registered</Badge>
                )}
              </DefinitionRow>
              <DefinitionRow label="Records on chain">{chain.totalOnChain}</DefinitionRow>
            </dl>
          ) : null}
        </Alert>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge tone="warn">{byStatus.pending ?? 0} pending</Badge>
          <Badge tone="good">{byStatus.confirmed ?? 0} confirmed</Badge>
          <Badge tone="attention">{byStatus.failed ?? 0} failed and retryable</Badge>
          <AttestationFlushButton />
        </div>
        <p className="mt-3 text-sm text-ink-700">
          What goes on-chain: an opaque organisation reference, an opaque request reference, a
          sha256 hash of a quantity-level manifest, an event type and a timestamp truncated to the
          minute. No names, contact details, coordinates, medical information, recordings or
          transcripts — those stay in this database. A record preserves that an acknowledgement was
          made; it is not independent proof that goods changed hands.
        </p>
      </Card>

      <FictionalNotice />
    </div>
  );
}
