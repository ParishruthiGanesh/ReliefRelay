'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, FieldLabel, Provenance, SectionHeading, Spinner } from './ui';
import { MapView, type MapPoint } from './MapView';

/**
 * The coordinator dashboard.
 *
 * More operational detail than a public screen, but the same rules: requested,
 * committed and received quantities never merge into one figure; a proposed
 * match is an argument a coordinator approves; a possible duplicate is a
 * suggestion, never an action.
 */

interface ItemSummary {
  itemId: string;
  categoryId: string;
  label: string;
  requestedLabel: string;
  committedLabel: string;
  receivedLabel: string;
  outstandingLabel: string;
  shortfallLabel: string | null;
  needsQuantityConfirmation: boolean;
}

interface Commitment {
  id: string;
  organizationName: string;
  qty: number;
  unit: string;
  status: string;
  receivedQty: number;
  dispatchedQty: number;
}

interface Allocation {
  itemId: string;
  categoryId: string;
  unit: string;
  outstandingQty: number | null;
  commitments: Commitment[];
}

interface RequestView {
  id: string;
  referenceCode: string;
  status: string;
  statusLabel: string;
  statusExplanation: string;
  createdAge: string;
  ageMinutes: number;
  groupSize: number | null;
  locationText: string;
  resolvedFacilityName: string | null;
  lat: number | null;
  lng: number | null;
  locationConfirmed: boolean;
  reportedUrgency: string | null;
  contactMethod: string | null;
  contactValue: string | null;
  originalText: string | null;
  transcriptText: string | null;
  inputMode: string;
  extractionProvider: string | null;
  sttProvider: string | null;
  behalfRole: string | null;
  missingFields: string[];
  reviewFlags: string[];
  dangerReported: boolean;
  itemSummaries: ItemSummary[];
  allocations: Allocation[];
  hasDiscrepancy: boolean;
  hasActiveAssignment: boolean;
  canSayHelpIsOnTheWay: boolean;
  provenance: { sourceLabel: string; lastUpdatedAge: string; isStale: boolean };
  advisories: Array<{ id: string; headline: string; severity: string; isSimulated: boolean }>;
  priority: { score: number; terms: Array<{ factor: string; contribution: number }> };
}

interface Lot {
  id: string;
  organizationName: string;
  categoryId: string;
  unit: string;
  qtyAvailable: number;
  qtyTotal: number;
  qtyCommitted: number;
  generalLocation: string;
  expiryNote: string | null;
  storageNote: string | null;
  handover: string;
}

interface Facility {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  capacityAvailable: number | null;
  capacityTotal: number | null;
  openingStatus: string;
  lastUpdateAge: string;
  freshness: 'fresh' | 'ageing' | 'stale' | 'expired';
  lastUpdateSource: string | null;
}

interface Advisory {
  id: string;
  headline: string;
  severity: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  isSimulated: boolean;
  status: string;
  source_name: string;
  coverage_label: string;
}

interface Suggestion {
  requestItemId: string;
  categoryLabel: string;
  unit: string;
  outstandingQty: number;
  lotId: string;
  organizationName: string;
  lotLocation: string;
  availableQty: number;
  suggestedQty: number;
  distanceKm: number | null;
  reasons: string[];
  cautions: string[];
}

const STATUSES = [
  'submitted',
  'under_review',
  'partially_allocated',
  'fully_allocated',
  'delivery_in_progress',
  'partially_received',
  'fulfilled',
  'disputed',
  'cancelled',
];

const CATEGORIES = [
  { id: 'meal_packs', label: 'Meal packs' },
  { id: 'drinking_water', label: 'Drinking water' },
  { id: 'hygiene_kits', label: 'Hygiene kits' },
  { id: 'shelter_spaces', label: 'Shelter spaces' },
];

export function CoordinatorDashboard({ center }: { center: { lat: number; lng: number } }) {
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [inventory, setInventory] = useState<Lot[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [situation, setSituation] = useState<{ lines: string[]; generatedBy: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [filters, setFilters] = useState({
    status: '',
    category: '',
    maxAge: '',
    missing: false,
    discrepancies: false,
    q: '',
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [volunteers, setVolunteers] = useState<Array<{ id: string; displayName: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.category) params.set('category', filters.category);
      if (filters.maxAge) params.set('maxAge', filters.maxAge);
      if (filters.missing) params.set('missing', '1');
      if (filters.discrepancies) params.set('discrepancies', '1');
      if (filters.q) params.set('q', filters.q);

      const [listResponse, matchResponse, volunteerResponse] = await Promise.all([
        fetch(`/api/coordinator/requests?${params.toString()}`),
        fetch('/api/coordinator/matches'),
        fetch('/api/coordinator/volunteers'),
      ]);
      const body = await listResponse.json();
      if (!listResponse.ok) throw new Error(body?.error?.message ?? 'Could not load the dashboard.');
      setRequests(body.requests);
      setInventory(body.inventory);
      setFacilities(body.facilities);
      setAdvisories(body.advisories);
      if (matchResponse.ok) setSituation((await matchResponse.json()).situation);
      if (volunteerResponse.ok) setVolunteers((await volunteerResponse.json()).volunteers);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (payload: Record<string, unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/coordinator/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        // A conflict here is the real thing: someone else took that stock.
        throw new Error(body?.error?.message ?? 'That action failed.');
      }
      let message = successMessage;
      if (body.chain?.skippedReason) {
        message += ` The blockchain acknowledgement is queued as pending (${body.chain.skippedReason}) — the relief record is saved either way.`;
      } else if (body.chain?.confirmed > 0) {
        message += ` ${body.chain.confirmed} acknowledgement(s) confirmed on the local development chain.`;
      }
      setNotice(message);
      await load();
      if (expanded) await loadSuggestions(expanded);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadSuggestions = async (requestId: string) => {
    const response = await fetch(`/api/coordinator/matches?requestId=${requestId}`);
    if (!response.ok) return;
    const body = await response.json();
    setSuggestions((current) => ({ ...current, [requestId]: body.suggestions ?? [] }));
  };

  const points: MapPoint[] = [
    ...advisories
      .filter((a) => a.status === 'active')
      .map((a) => ({
        id: `adv-${a.id}`,
        lat: a.center_lat,
        lng: a.center_lng,
        label: a.headline,
        detail: `${a.source_name}${a.isSimulated ? ' — SIMULATED' : ''} · ${a.coverage_label}`,
        tone: 'advisory' as const,
        radiusKm: a.radius_km,
      })),
    ...facilities.map((f) => ({
      id: f.id,
      lat: f.lat,
      lng: f.lng,
      label: f.name,
      detail:
        f.kind === 'shelter'
          ? `${f.capacityAvailable ?? '?'} of ${f.capacityTotal ?? '?'} spaces · updated ${f.lastUpdateAge}`
          : `Supply hub · updated ${f.lastUpdateAge}`,
      tone: f.kind === 'shelter' ? ('shelter' as const) : ('hub' as const),
    })),
    ...requests
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        id: r.id,
        lat: r.lat!,
        lng: r.lng!,
        label: `${r.referenceCode} — ${r.statusLabel}`,
        detail: `${r.locationText} · priority ${r.priority.score}`,
        tone: 'need' as const,
        href: `/coordinator/requests/${r.id}`,
      })),
  ];

  const staleFacilities = facilities.filter((f) => f.freshness === 'stale' || f.freshness === 'expired');

  return (
    <div className="space-y-5">
      {situation ? (
        <Card className="border-teal-600/30">
          <SectionHeading description={situation.generatedBy}>Situation now</SectionHeading>
          <ul className="space-y-1 text-[0.95rem] text-ink-900">
            {situation.lines.map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {notice ? <Alert tone="good">{notice}</Alert> : null}
      {error ? <Alert tone="attention" title="That did not work">{error}</Alert> : null}

      <Card>
        <SectionHeading>Filters</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <FieldLabel htmlFor="f-status">Status</FieldLabel>
            <select
              className="rr-input mt-1"
              id="f-status"
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              value={filters.status}
            >
              <option value="">Any status</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="f-category">Category</FieldLabel>
            <select
              className="rr-input mt-1"
              id="f-category"
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              value={filters.category}
            >
              <option value="">Any category</option>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="f-age">Age</FieldLabel>
            <select
              className="rr-input mt-1"
              id="f-age"
              onChange={(e) => setFilters({ ...filters, maxAge: e.target.value })}
              value={filters.maxAge}
            >
              <option value="">Any age</option>
              <option value="60">Last hour</option>
              <option value="240">Last 4 hours</option>
              <option value="720">Last 12 hours</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="f-q">Reference or place</FieldLabel>
            <input
              className="rr-input mt-1"
              id="f-q"
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="RR-1042 or Riverside"
              value={filters.q}
            />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={filters.missing}
                className="h-5 w-5 rounded border-sand-300 text-teal-600"
                onChange={(e) => setFilters({ ...filters, missing: e.target.checked })}
                type="checkbox"
              />
              Missing essential information
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={filters.discrepancies}
                className="h-5 w-5 rounded border-sand-300 text-teal-600"
                onChange={(e) => setFilters({ ...filters, discrepancies: e.target.checked })}
                type="checkbox"
              />
              Delivery discrepancies
            </label>
          </div>
        </div>
      </Card>

      <MapView center={center} height={380} listTitle="Everything on this map, as a list" points={points} />

      {staleFacilities.length > 0 ? (
        <Alert tone="attention" title="Facility figures that need re-confirming">
          <ul className="space-y-1">
            {staleFacilities.map((f) => (
              <li key={f.id}>
                {f.name} — last update {f.lastUpdateAge}. Do not send anyone on this figure without
                checking.
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section>
        <SectionHeading description="Ordered by a visible, adjustable priority score. Expand a request to see the factors and to allocate.">
          Requests ({requests.length})
        </SectionHeading>
        {loading ? <Spinner label="Loading requests…" /> : null}
        <ul className="space-y-4">
          {requests.map((request) => (
            <Card as="li" key={request.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="text-lg font-semibold text-teal-700 underline" href={`/coordinator/requests/${request.id}`}>
                      {request.referenceCode}
                    </Link>
                    <Badge tone={request.status === 'fulfilled' ? 'good' : 'teal'}>
                      {request.statusLabel}
                    </Badge>
                    {request.dangerReported ? <Badge tone="attention">Danger reported</Badge> : null}
                    {request.hasDiscrepancy ? <Badge tone="attention">Discrepancy</Badge> : null}
                    {request.missingFields.length > 0 ? (
                      <Badge tone="warn">Missing information</Badge>
                    ) : null}
                    {request.advisories.length > 0 ? (
                      <Badge tone="simulated">
                        In advisory area{request.advisories[0].isSimulated ? ' (simulated)' : ''}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-700">
                    {request.resolvedFacilityName ?? request.locationText}
                    {!request.locationConfirmed ? (
                      <span className="text-ember-700"> · location unconfirmed</span>
                    ) : null}
                    {request.groupSize !== null ? ` · ${request.groupSize} people` : ''} ·{' '}
                    {request.createdAge}
                  </p>
                  <p className="mt-1">
                    <Provenance
                      age={request.provenance.lastUpdatedAge}
                      freshness={request.provenance.isStale ? 'stale' : 'fresh'}
                      sourceLabel={request.provenance.sourceLabel}
                    />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-ink-500">Priority</p>
                  <p className="text-2xl font-semibold text-ink-900">{request.priority.score}</p>
                </div>
              </div>

              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">Quantities for {request.referenceCode}</caption>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-1" scope="col">Item</th>
                    <th className="py-1" scope="col">Requested</th>
                    <th className="py-1" scope="col">Committed</th>
                    <th className="py-1" scope="col">Received</th>
                    <th className="py-1" scope="col">Unmet</th>
                  </tr>
                </thead>
                <tbody>
                  {request.itemSummaries.map((item) => (
                    <tr className="border-t border-sand-200" key={item.itemId}>
                      <th className="py-1.5 pr-2 text-left font-semibold" scope="row">{item.label}</th>
                      <td className={item.needsQuantityConfirmation ? 'text-ember-700' : ''}>
                        {item.requestedLabel}
                      </td>
                      <td>{item.committedLabel}</td>
                      <td>{item.receivedLabel}</td>
                      <td className="font-semibold">{item.outstandingLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {request.itemSummaries.some((i) => i.shortfallLabel) ? (
                <p className="mt-2 text-sm text-ember-700">
                  {request.itemSummaries
                    .filter((i) => i.shortfallLabel)
                    .map((i) => `${i.label}: ${i.shortfallLabel}`)
                    .join(' · ')}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === 'submitted' ? (
                  <Button
                    disabled={busy}
                    onClick={() => void act({ action: 'review', requestId: request.id }, `${request.referenceCode} marked as reviewed.`)}
                  >
                    Mark as reviewed
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => {
                    const next = expanded === request.id ? null : request.id;
                    setExpanded(next);
                    if (next) void loadSuggestions(next);
                  }}
                >
                  {expanded === request.id ? 'Hide allocation' : 'Allocate supplies'}
                </Button>
                <Link
                  className="inline-flex min-h-[48px] items-center rounded-xl px-4 font-semibold text-ink-700 hover:bg-sand-100"
                  href={`/coordinator/requests/${request.id}`}
                >
                  Open full record
                </Link>
              </div>

              {expanded === request.id ? (
                <RequestAllocationPanel
                  busy={busy}
                  inventory={inventory}
                  onAct={act}
                  request={request}
                  suggestions={suggestions[request.id] ?? []}
                  volunteers={volunteers}
                />
              ) : null}
            </Card>
          ))}
        </ul>
        {!loading && requests.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">No requests match these filters.</p>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function RequestAllocationPanel({
  request,
  inventory,
  suggestions,
  volunteers,
  busy,
  onAct,
}: {
  request: RequestView;
  inventory: Lot[];
  suggestions: Suggestion[];
  volunteers: Array<{ id: string; displayName: string }>;
  busy: boolean;
  onAct: (payload: Record<string, unknown>, message: string) => Promise<void>;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [confirmQty, setConfirmQty] = useState<Record<string, string>>({});
  const [receiptQty, setReceiptQty] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});

  return (
    <div className="mt-4 space-y-4 rounded-xl bg-sand-50 p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink-500">Priority factors</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {request.priority.terms
            .filter((term) => term.contribution > 0)
            .map((term) => (
              <li key={term.factor}>
                {term.factor}: <strong>+{term.contribution}</strong>
              </li>
            ))}
        </ul>
        <p className="mt-1 text-xs text-ink-500">
          These are the only factors used. Nothing about language, phrasing, device or
          identification is involved.
        </p>
      </div>

      {/* Unknown quantities must be resolved by a person before allocating. */}
      {request.itemSummaries.filter((i) => i.needsQuantityConfirmation).length > 0 ? (
        <div className="rounded-xl border border-ember-500/40 bg-ember-50 p-3">
          <p className="font-semibold text-ember-700">Quantities still need confirming</p>
          <p className="text-sm text-ember-700">
            Stock cannot be committed against an unknown amount — there is no number to check it
            against. Confirm the figure with the requester first.
          </p>
          {request.itemSummaries
            .filter((i) => i.needsQuantityConfirmation)
            .map((item) => (
              <div className="mt-2 flex flex-wrap items-end gap-2" key={item.itemId}>
                <div>
                  <FieldLabel htmlFor={`cq-${item.itemId}`}>{item.label}</FieldLabel>
                  <input
                    className="rr-input mt-1 max-w-[10rem]"
                    id={`cq-${item.itemId}`}
                    min="1"
                    onChange={(e) => setConfirmQty({ ...confirmQty, [item.itemId]: e.target.value })}
                    type="number"
                    value={confirmQty[item.itemId] ?? ''}
                  />
                </div>
                <Button
                  disabled={busy || !confirmQty[item.itemId]}
                  onClick={() =>
                    void onAct(
                      {
                        action: 'set_quantity',
                        requestItemId: item.itemId,
                        quantity: Number(confirmQty[item.itemId]),
                      },
                      `${item.label} quantity confirmed.`,
                    )
                  }
                >
                  Confirm quantity
                </Button>
              </div>
            ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Proposed matches</p>
          <p className="text-xs text-ink-500">
            Ranked by explainable rules. You approve each one; nothing is allocated automatically.
          </p>
          <ul className="mt-2 space-y-2">
            {suggestions.map((suggestion) => (
              <li className="rounded-xl border border-sand-200 bg-white p-3" key={`${suggestion.requestItemId}-${suggestion.lotId}`}>
                <p className="font-semibold text-ink-900">
                  {suggestion.suggestedQty} {suggestion.unit} of{' '}
                  {suggestion.categoryLabel.toLowerCase()} from {suggestion.organizationName}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-ink-700">
                  {suggestion.reasons.map((reason) => (
                    <li key={reason}>• {reason}</li>
                  ))}
                </ul>
                {suggestion.cautions.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-ember-700">
                    {suggestion.cautions.map((caution) => (
                      <li key={caution}>• {caution}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <FieldLabel htmlFor={`sq-${suggestion.requestItemId}-${suggestion.lotId}`}>
                      How much to commit, in {suggestion.unit}
                    </FieldLabel>
                    <input
                      className="rr-input mt-1 max-w-[10rem]"
                      id={`sq-${suggestion.requestItemId}-${suggestion.lotId}`}
                      max={Math.min(suggestion.availableQty, suggestion.outstandingQty)}
                      min="1"
                      onChange={(e) =>
                        setQuantities({
                          ...quantities,
                          [`${suggestion.requestItemId}-${suggestion.lotId}`]: e.target.value,
                        })
                      }
                      type="number"
                      value={
                        quantities[`${suggestion.requestItemId}-${suggestion.lotId}`] ??
                        String(suggestion.suggestedQty)
                      }
                    />
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void onAct(
                        {
                          action: 'commit',
                          requestItemId: suggestion.requestItemId,
                          inventoryLotId: suggestion.lotId,
                          qty: Number(
                            quantities[`${suggestion.requestItemId}-${suggestion.lotId}`] ??
                              suggestion.suggestedQty,
                          ),
                        },
                        `Committed from ${suggestion.organizationName}. A commitment is a promise, not a delivery.`,
                      )
                    }
                  >
                    Approve this commitment
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          No stock is available to propose for the outstanding items right now.
        </p>
      )}

      {/* Existing commitments: dispatch, assign, receipt, cancel */}
      {request.allocations.some((a) => a.commitments.length > 0) ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Commitments on this request</p>
          <ul className="mt-2 space-y-2">
            {request.allocations.flatMap((allocation) =>
              allocation.commitments.map((commitment) => (
                <li className="rounded-xl border border-sand-200 bg-white p-3" key={commitment.id}>
                  <p className="text-sm">
                    <strong>{commitment.organizationName}</strong> — {commitment.qty}{' '}
                    {commitment.unit} · <Badge tone="neutral">{commitment.status.replace('_', ' ')}</Badge>
                    {commitment.receivedQty > 0
                      ? ` · ${commitment.receivedQty} ${commitment.unit} confirmed received`
                      : ''}
                  </p>

                  {['committed', 'dispatched'].includes(commitment.status) ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {commitment.status === 'committed' ? (
                        <>
                          <Button
                            disabled={busy}
                            variant="secondary"
                            onClick={() =>
                              void onAct(
                                {
                                  action: 'dispatch',
                                  commitmentId: commitment.id,
                                  qty: commitment.qty,
                                  accessNote: 'Access report from the shelter desk, unverified.',
                                  accessNoteSource: 'Shelter representative (fictional)',
                                },
                                'Dispatch recorded. Outstanding need is unchanged until a receipt is confirmed.',
                              )
                            }
                          >
                            Record dispatch
                          </Button>
                          {volunteers.length > 0 ? (
                            <div>
                              <FieldLabel htmlFor={`vol-${commitment.id}`}>
                                Assign an approved volunteer
                              </FieldLabel>
                              <select
                                className="rr-input mt-1"
                                id={`vol-${commitment.id}`}
                                onChange={(e) => {
                                  if (!e.target.value) return;
                                  void onAct(
                                    {
                                      action: 'assign',
                                      commitmentId: commitment.id,
                                      volunteerId: e.target.value,
                                      instructions:
                                        'Collect from the hub, deliver to the shelter desk, ask for the duty warden.',
                                    },
                                    'Delivery team assigned.',
                                  );
                                }}
                                value=""
                              >
                                <option value="">Choose a volunteer…</option>
                                {volunteers.map((volunteer) => (
                                  <option key={volunteer.id} value={volunteer.id}>
                                    {volunteer.displayName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      <div>
                        <FieldLabel htmlFor={`rq-${commitment.id}`}>
                          Confirmed received, in {commitment.unit}
                        </FieldLabel>
                        <input
                          className="rr-input mt-1 max-w-[10rem]"
                          id={`rq-${commitment.id}`}
                          max={commitment.qty}
                          min="0"
                          onChange={(e) => setReceiptQty({ ...receiptQty, [commitment.id]: e.target.value })}
                          type="number"
                          value={receiptQty[commitment.id] ?? ''}
                        />
                      </div>
                      <Button
                        disabled={busy || receiptQty[commitment.id] === undefined || receiptQty[commitment.id] === ''}
                        onClick={() =>
                          void onAct(
                            {
                              action: 'receipt',
                              commitmentId: commitment.id,
                              qtyReceived: Number(receiptQty[commitment.id]),
                              confirmedByKind: 'coordinator',
                            },
                            'Receipt recorded. Any shortfall is now unmet again and visible.',
                          )
                        }
                      >
                        Record receipt
                      </Button>

                      <div>
                        <FieldLabel htmlFor={`cr-${commitment.id}`}>Cancel — reason</FieldLabel>
                        <input
                          className="rr-input mt-1"
                          id={`cr-${commitment.id}`}
                          onChange={(e) => setCancelReason({ ...cancelReason, [commitment.id]: e.target.value })}
                          placeholder="Why is this being cancelled?"
                          value={cancelReason[commitment.id] ?? ''}
                        />
                      </div>
                      <Button
                        disabled={busy || (cancelReason[commitment.id] ?? '').length < 2}
                        variant="danger"
                        onClick={() =>
                          void onAct(
                            {
                              action: 'cancel_commitment',
                              commitmentId: commitment.id,
                              reason: cancelReason[commitment.id],
                            },
                            'Commitment cancelled. The stock is available again and the need has reopened.',
                          )
                        }
                      >
                        Cancel commitment
                      </Button>
                    </div>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        </div>
      ) : null}

      {/* Sensitive fields, coordinator-only */}
      <details className="rounded-xl border border-sand-200 bg-white p-3">
        <summary className="cursor-pointer font-semibold text-ink-900">
          Sensitive details (coordinators only)
        </summary>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-700">Exact location</dt>
            <dd>
              {request.locationText}
              {request.lat !== null ? ` (${request.lat.toFixed(4)}, ${request.lng!.toFixed(4)})` : ''}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-700">Contact</dt>
            <dd>
              {request.contactMethod && request.contactMethod !== 'none'
                ? `${request.contactMethod}: ${request.contactValue}`
                : 'none given'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-700">Submitted by</dt>
            <dd>{request.behalfRole?.replace('_', ' ')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-700">How it was captured</dt>
            <dd>
              {request.inputMode}
              {request.sttProvider ? ` · transcribed by ${request.sttProvider}` : ''}
              {request.extractionProvider ? ` · extracted by ${request.extractionProvider}` : ''}
            </dd>
          </div>
          {request.originalText ? (
            <div>
              <dt className="font-semibold text-ink-700">In their own words</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-sand-50 p-2">
                {request.originalText}
              </dd>
            </div>
          ) : null}
          {request.reviewFlags.length > 0 ? (
            <div className="flex gap-2">
              <dt className="font-semibold text-ink-700">Review flags</dt>
              <dd>{request.reviewFlags.join(', ')}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </div>
  );
}
