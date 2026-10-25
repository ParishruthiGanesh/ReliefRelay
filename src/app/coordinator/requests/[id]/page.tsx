import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { getDb } from '@/lib/db';
import { listAdvisories } from '@/lib/domain/advisories';
import { coordinatorRequestView } from '@/lib/domain/dashboard';
import { getRequestById } from '@/lib/domain/requests';
import { suggestMatches } from '@/lib/domain/matching';
import { explainManifest, type AttestationManifest } from '@/lib/domain/attestations';
import { Badge, Card, DefinitionRow, FictionalNotice, Provenance, SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The full record for one request, including the attestation trail. */
export default async function CoordinatorRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user || user.role !== 'coordinator') redirect('/login');

  const { id } = await params;
  const db = getDb();
  const row = getRequestById(db, id);
  if (!row) notFound();

  const view = coordinatorRequestView(db, row, listAdvisories(db));
  const suggestions = suggestMatches(db, row);
  const events = db
    .prepare(
      `SELECT e.kind, e.detail, e.created_at, e.actor_kind, u.display_name
         FROM request_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.request_id = ? ORDER BY e.created_at`,
    )
    .all(id) as Array<{
    kind: string;
    detail: string;
    created_at: string;
    actor_kind: string;
    display_name: string | null;
  }>;

  const attestations = db
    .prepare(
      `SELECT a.*, o.name AS org_name FROM attestations a
         JOIN organizations o ON o.chain_org_ref = a.chain_org_ref
         JOIN commitments c ON c.id = a.commitment_id
        WHERE c.request_id = ? ORDER BY a.created_at`,
    )
    .all(id) as Array<{
    id: string;
    event_type: string;
    org_name: string;
    manifest_hash: string;
    manifest_json: string;
    status: string;
    attempts: number;
    last_error: string | null;
    tx_hash: string | null;
    block_number: number | null;
    chain_id: string | null;
    created_at: string;
  }>;

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-semibold text-teal-700 underline" href="/coordinator">
          ← Back to the dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink-900">{view.referenceCode}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="teal">{view.statusLabel}</Badge>
          {view.dangerReported ? <Badge tone="attention">Danger reported</Badge> : null}
          {view.hasDiscrepancy ? <Badge tone="attention">Delivery discrepancy</Badge> : null}
          {view.hasActiveAssignment ? <Badge tone="good">Delivery team assigned</Badge> : null}
        </div>
        <p className="mt-2 text-ink-700">{view.statusExplanation}</p>
      </div>

      {view.dangerReported ? (
        <Card className="border-l-4 border-l-ember-600">
          <SectionHeading>Immediate danger was reported</SectionHeading>
          <p className="text-sm text-ink-700">
            The person described immediate danger. ReliefRelay has <strong>not</strong> notified any
            responder — it has no integration that could. Escalate this through the responders you
            work with, by the means you normally use.
          </p>
        </Card>
      ) : null}

      <Card>
        <SectionHeading>Record</SectionHeading>
        <dl>
          <DefinitionRow label="Submitted">
            {new Date(view.createdAt).toLocaleString()} ({view.createdAge})
          </DefinitionRow>
          <DefinitionRow label="Location">
            {view.locationText}
            {view.lat !== null ? ` — ${view.lat.toFixed(4)}, ${view.lng!.toFixed(4)}` : ''}
            {!view.locationConfirmed ? (
              <span className="ml-2 text-ember-700">not confirmed by the requester</span>
            ) : null}
          </DefinitionRow>
          {view.resolvedFacilityName ? (
            <DefinitionRow label="Facility">{view.resolvedFacilityName}</DefinitionRow>
          ) : null}
          <DefinitionRow label="People">
            {view.groupSize ?? 'not given'}
            {view.groupSizeUncertain ? ' (approximate)' : ''}
            <span className="ml-2 text-xs text-ink-500">
              Never used to derive a supply quantity.
            </span>
          </DefinitionRow>
          <DefinitionRow label="Urgency as reported">
            {view.reportedUrgency ?? 'not stated'}
          </DefinitionRow>
          <DefinitionRow label="Submitted by">{view.behalfRole?.replace('_', ' ')}</DefinitionRow>
          <DefinitionRow label="Contact (coordinators only)">
            {view.contactMethod && view.contactMethod !== 'none'
              ? `${view.contactMethod}: ${view.contactValue}`
              : 'none given'}
          </DefinitionRow>
          <DefinitionRow label="Captured as">
            {view.inputMode}
            {view.sttProvider ? ` · transcribed by ${view.sttProvider}` : ''}
            {view.extractionProvider ? ` · extracted by ${view.extractionProvider}` : ''}
          </DefinitionRow>
          <DefinitionRow label="Provenance">
            <Provenance
              age={view.provenance.lastUpdatedAge}
              freshness={view.provenance.isStale ? 'stale' : 'fresh'}
              sourceLabel={view.provenance.sourceLabel}
            />
          </DefinitionRow>
          {view.missingFields.length > 0 ? (
            <DefinitionRow label="Missing information">
              <span className="text-ember-700">{view.missingFields.join(', ')}</span>
            </DefinitionRow>
          ) : null}
          {view.advisories.length > 0 ? (
            <DefinitionRow label="Advisory areas">
              <ul>
                {view.advisories.map((advisory) => (
                  <li key={advisory.id}>
                    {advisory.headline}{' '}
                    {advisory.isSimulated ? <Badge tone="simulated">simulated</Badge> : null}
                  </li>
                ))}
              </ul>
            </DefinitionRow>
          ) : null}
        </dl>
      </Card>

      {view.originalText ? (
        <Card>
          <SectionHeading description="Kept so a coordinator can always read what someone actually said. Never published and never written on-chain.">
            In their own words
          </SectionHeading>
          <p className="whitespace-pre-wrap rounded-xl bg-sand-100 p-3 text-sm">{view.originalText}</p>
        </Card>
      ) : null}

      <Card>
        <SectionHeading description="Four separate figures, never merged.">Quantities</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-1" scope="col">Item</th>
                <th className="py-1" scope="col">Requested</th>
                <th className="py-1" scope="col">Committed (open)</th>
                <th className="py-1" scope="col">Confirmed received</th>
                <th className="py-1" scope="col">Still unmet</th>
                <th className="py-1" scope="col">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {view.itemSummaries.map((item) => (
                <tr className="border-t border-sand-200" key={item.itemId}>
                  <th className="py-2 pr-2 text-left font-semibold" scope="row">{item.label}</th>
                  <td className={item.needsQuantityConfirmation ? 'text-ember-700' : ''}>
                    {item.requestedLabel}
                  </td>
                  <td>{item.committedLabel}</td>
                  <td>{item.receivedLabel}</td>
                  <td className="font-semibold">{item.outstandingLabel}</td>
                  <td className="text-ember-700">{item.shortfallLabel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionHeading description="Each organisation's promise, dispatch and confirmed receipt, kept apart.">
          Commitments
        </SectionHeading>
        {view.allocations.every((a) => a.commitments.length === 0) ? (
          <p className="text-sm text-ink-500">Nothing has been committed yet.</p>
        ) : (
          <ul className="space-y-2">
            {view.allocations.flatMap((allocation) =>
              allocation.commitments.map((commitment) => (
                <li className="rounded-xl border border-sand-200 p-3 text-sm" key={commitment.id}>
                  <strong>{commitment.organizationName}</strong> — {commitment.qty} {commitment.unit}{' '}
                  <Badge tone="neutral">{commitment.status.replace('_', ' ')}</Badge>
                  <br />
                  dispatched {commitment.dispatchedQty} {commitment.unit} · confirmed received{' '}
                  {commitment.receivedQty} {commitment.unit}
                  {commitment.qty > commitment.receivedQty &&
                  ['received', 'partially_received'].includes(commitment.status) ? (
                    <span className="text-ember-700">
                      {' '}
                      · {commitment.qty - commitment.receivedQty} {commitment.unit} short
                    </span>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-500">
          Allocate from the dashboard, where the proposed matches and their reasons are shown.
        </p>
      </Card>

      {suggestions.length > 0 ? (
        <Card>
          <SectionHeading description="Proposals with their reasoning. A coordinator approves each one on the dashboard.">
            Available stock for the outstanding items
          </SectionHeading>
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li className="rounded-xl border border-sand-200 p-3 text-sm" key={`${suggestion.requestItemId}-${suggestion.lotId}`}>
                <strong>
                  {suggestion.suggestedQty} {suggestion.unit}
                </strong>{' '}
                of {suggestion.categoryLabel.toLowerCase()} from {suggestion.organizationName} at{' '}
                {suggestion.lotLocation}
                <ul className="mt-1 text-ink-700">
                  {suggestion.reasons.map((reason) => (
                    <li key={reason}>• {reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionHeading description="Organisation-level acknowledgements. Opaque references and manifest hashes only.">
          Blockchain acknowledgements
        </SectionHeading>
        {attestations.length === 0 ? (
          <p className="text-sm text-ink-500">
            None yet. Acknowledgements are created when stock is committed, dispatched or confirmed
            received.
          </p>
        ) : (
          <ul className="space-y-3">
            {attestations.map((attestation) => {
              const manifest = JSON.parse(attestation.manifest_json) as AttestationManifest;
              return (
                <li className="rounded-xl border border-sand-200 p-3 text-sm" key={attestation.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        attestation.status === 'confirmed'
                          ? 'good'
                          : attestation.status === 'failed'
                            ? 'attention'
                            : 'warn'
                      }
                    >
                      {attestation.status === 'confirmed'
                        ? 'Confirmed on local development chain'
                        : attestation.status === 'failed'
                          ? `Failed and retryable (${attestation.attempts} attempts)`
                          : 'Pending attestation'}
                    </Badge>
                    <span className="font-semibold">{attestation.event_type}</span>
                    <span className="text-ink-500">{attestation.org_name}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs">{attestation.manifest_hash}</p>
                  {attestation.tx_hash ? (
                    <p className="break-all font-mono text-xs text-ink-500">
                      tx {attestation.tx_hash} · block {attestation.block_number} · chain{' '}
                      {attestation.chain_id}
                    </p>
                  ) : null}
                  {attestation.last_error ? (
                    <p className="text-xs text-ember-700">Last error: {attestation.last_error}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-500">{explainManifest(manifest)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeading>Timeline</SectionHeading>
        <ol className="space-y-2 text-sm">
          {events.map((event, index) => (
            <li className="border-b border-sand-200 pb-2 last:border-b-0" key={index}>
              <span className="font-semibold text-ink-900">{event.kind.replace(/_/g, ' ')}</span>
              <span className="ml-2 text-ink-500">
                {new Date(event.created_at).toLocaleString()} ·{' '}
                {event.display_name ?? event.actor_kind.replace('_', ' ')}
              </span>
              <pre className="mt-1 overflow-x-auto rounded bg-sand-50 p-2 text-xs">
                {JSON.stringify(JSON.parse(event.detail), null, 1)}
              </pre>
            </li>
          ))}
        </ol>
      </Card>

      <FictionalNotice />
    </div>
  );
}
