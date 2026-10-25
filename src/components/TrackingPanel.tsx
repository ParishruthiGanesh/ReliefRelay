'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DefinitionRow, FieldLabel, SectionHeading, Spinner } from './ui';

/**
 * The private tracking view.
 *
 * Two things this screen is careful about:
 *   * It states the real status in plain words, and only says anything about
 *     supplies being on the way when the server reports an actual assignment.
 *   * A receipt is read back and confirmed before it is saved, because
 *     "we received 30 of the 50" changes what everyone else sees.
 */

interface TrackedRequest {
  referenceCode: string;
  status: string;
  statusLabel: string;
  statusExplanation: string;
  canSayHelpIsOnTheWay: boolean;
  createdAge: string;
  locationText: string;
  groupSize: number | null;
  items: Array<{
    itemId: string;
    label: string;
    requestedLabel: string;
    committedLabel: string;
    receivedLabel: string;
    outstandingLabel: string;
    shortfallLabel: string | null;
    commitments: Array<{
      id: string;
      organizationName: string;
      qty: number;
      unit: string;
      status: string;
      receivedQty: number;
      canConfirmReceipt: boolean;
    }>;
  }>;
  missingFields: string[];
  timeline: Array<{ kind: string; detail: Record<string, unknown>; createdAt: string; actorKind: string }>;
  dangerReported: boolean;
}

interface PendingReceipt {
  commitmentId: string;
  organizationName: string;
  committedQty: number;
  unit: string;
  itemLabel: string;
  qtyReceived: number;
  note: string;
}

const EVENT_LABELS: Record<string, string> = {
  submitted: 'Request submitted',
  coordinator_reviewed: 'A coordinator reviewed the request',
  status_changed: 'Status changed',
  commitment_recorded: 'An organisation promised supplies',
  commitment_cancelled: 'A promise was cancelled and the need reopened',
  dispatch_recorded: 'Supplies were recorded as dispatched',
  receipt_confirmed: 'Receipt confirmed',
  delivery_failed: 'A delivery did not arrive',
  delivery_assigned: 'A delivery team was assigned',
  delivery_reassigned: 'The delivery was reassigned',
  quantity_confirmed: 'A quantity was confirmed',
  information_added: 'Information was added',
  cancelled_by_requester: 'Cancelled by the requester',
  commitment_disputed: 'A delivery was disputed',
};

export function TrackingPanel({ token }: { token: string }) {
  const [request, setRequest] = useState<TrackedRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [spokenUpdate, setSpokenUpdate] = useState('');
  const [pending, setPending] = useState<PendingReceipt | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/track/${token}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That link did not work.');
      setRequest(body.request);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Reads a spoken or typed update such as "we received 30 of the 50 meal
   * packs" into a proposed receipt. It proposes only: the change is read back
   * and must be confirmed before anything is saved.
   */
  const interpretUpdate = () => {
    if (!request) return;
    const text = spokenUpdate.toLowerCase();
    const numbers = [...text.matchAll(/\b(\d{1,6})\b/g)].map((m) => Number(m[1]));
    const nothingArrived = /\b(nothing|none|did ?n[o']?t arrive|no delivery|never came|nothing came)\b/.test(text);

    const candidates = request.items.flatMap((item) =>
      item.commitments
        .filter((c) => c.canConfirmReceipt)
        .map((c) => ({ item, commitment: c })),
    );
    if (candidates.length === 0) {
      setError('There is no promised delivery to confirm yet.');
      return;
    }

    // Match on the resource word if they named one; otherwise take the only
    // open delivery, and ask if there is more than one.
    const matched =
      candidates.find(({ item }) => text.includes(item.label.toLowerCase().split(' ')[0])) ??
      (candidates.length === 1 ? candidates[0] : null);

    if (!matched) {
      setError(
        'More than one delivery is outstanding. Say which supplies you are talking about, or use the buttons below.',
      );
      return;
    }

    const qty = nothingArrived
      ? 0
      : (numbers.find((n) => n <= matched.commitment.qty) ?? null);
    if (qty === null) {
      setError(
        `Say how much arrived, in ${matched.commitment.unit}. The promised amount was ${matched.commitment.qty} ${matched.commitment.unit}.`,
      );
      return;
    }

    setError(null);
    setPending({
      commitmentId: matched.commitment.id,
      organizationName: matched.commitment.organizationName,
      committedQty: matched.commitment.qty,
      unit: matched.commitment.unit,
      itemLabel: matched.item.label,
      qtyReceived: qty,
      note: spokenUpdate,
    });
  };

  const saveReceipt = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/track/${token}/receipt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commitmentId: pending.commitmentId,
          qtyReceived: pending.qtyReceived,
          note: pending.note || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      setRequest(body.request);
      setPending(null);
      setSpokenUpdate('');
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/track/${token}/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      setRequest(body.request);
      setNote('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Opening your request…" />;

  if (!request) {
    return (
      <Alert tone="attention" title="That link did not open a request">
        <p>{error}</p>
        <p className="mt-2">
          Tracking links are long and every character matters. A reference code such as RR-1042 is
          not a tracking link, and cannot open a request on its own.
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-teal-600/30">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink-900">{request.referenceCode}</h1>
          <Badge tone={request.status === 'fulfilled' ? 'good' : 'teal'}>{request.statusLabel}</Badge>
        </div>
        <p className="mt-2 text-lg text-ink-900">{request.statusExplanation}</p>
        {!request.canSayHelpIsOnTheWay ? (
          <p className="mt-2 text-sm text-ink-500">
            No delivery team is on the way yet. This page will say so plainly the moment one is
            assigned.
          </p>
        ) : null}
        <dl className="mt-4">
          <DefinitionRow label="Submitted">{request.createdAge}</DefinitionRow>
          <DefinitionRow label="Place">{request.locationText}</DefinitionRow>
          {request.groupSize !== null ? (
            <DefinitionRow label="People">{request.groupSize}</DefinitionRow>
          ) : null}
        </dl>
        {request.missingFields.length > 0 ? (
          <p className="mt-3 text-sm text-ember-700">
            A coordinator can see this is still missing: {request.missingFields.join(', ')}. You can
            add it below.
          </p>
        ) : null}
      </Card>

      {request.dangerReported ? (
        <Alert tone="emergency" title="You reported immediate danger">
          Please contact your local emergency services by phone if you have not already.
          ReliefRelay has not contacted anyone on your behalf. A coordinator can see this flag so
          they can escalate it to the responders they work with.
        </Alert>
      ) : null}

      <section>
        <SectionHeading description="Requested, promised, and actually confirmed as arrived — kept apart, because a promise is not a delivery.">
          What you asked for
        </SectionHeading>
        <ul className="space-y-4">
          {request.items.map((item) => (
            <Card as="li" key={item.itemId}>
              <h3 className="text-lg font-semibold text-ink-900">{item.label}</h3>
              <dl className="mt-2">
                <DefinitionRow label="You asked for">{item.requestedLabel}</DefinitionRow>
                <DefinitionRow label="Promised">{item.committedLabel}</DefinitionRow>
                <DefinitionRow label="Confirmed arrived">{item.receivedLabel}</DefinitionRow>
                <DefinitionRow label="Still unmet">{item.outstandingLabel}</DefinitionRow>
                {item.shortfallLabel ? (
                  <DefinitionRow label="Shortfall">
                    <span className="text-ember-700">{item.shortfallLabel}</span>
                  </DefinitionRow>
                ) : null}
              </dl>
              {item.commitments.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {item.commitments.map((commitment) => (
                    <li className="rounded-xl border border-sand-200 p-3" key={commitment.id}>
                      <p className="text-sm">
                        <strong>{commitment.organizationName}</strong> promised {commitment.qty}{' '}
                        {commitment.unit} — <Badge tone="neutral">{commitment.status.replace('_', ' ')}</Badge>
                      </p>
                      {commitment.receivedQty > 0 ? (
                        <p className="text-sm text-ink-700">
                          {commitment.receivedQty} {commitment.unit} confirmed as received.
                        </p>
                      ) : null}
                      {commitment.canConfirmReceipt ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setPending({
                                commitmentId: commitment.id,
                                organizationName: commitment.organizationName,
                                committedQty: commitment.qty,
                                unit: commitment.unit,
                                itemLabel: item.label,
                                qtyReceived: commitment.qty,
                                note: '',
                              })
                            }
                          >
                            Confirm what arrived
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() =>
                              setPending({
                                commitmentId: commitment.id,
                                organizationName: commitment.organizationName,
                                committedQty: commitment.qty,
                                unit: commitment.unit,
                                itemLabel: item.label,
                                qtyReceived: 0,
                                note: 'Nothing arrived.',
                              })
                            }
                          >
                            Nothing arrived
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-500">
                  No organisation has promised anything for this item yet.
                </p>
              )}
            </Card>
          ))}
        </ul>
      </section>

      {/* Read-back before saving a receipt */}
      {pending ? (
        <Card className="border-ember-500/40">
          <SectionHeading description="Nothing is saved until you confirm this.">
            Please check this is right
          </SectionHeading>
          <p className="text-lg text-ink-900">
            You are telling us that <strong>{pending.qtyReceived}</strong> of the{' '}
            <strong>{pending.committedQty}</strong> {pending.unit} of{' '}
            {pending.itemLabel.toLowerCase()} promised by {pending.organizationName}{' '}
            {pending.qtyReceived === 0 ? 'did not arrive at all' : 'arrived'}.
            {pending.qtyReceived < pending.committedQty
              ? ` The remaining ${pending.committedQty - pending.qtyReceived} ${pending.unit} will go back to being unmet, and coordinators will see the shortfall.`
              : ''}
          </p>
          <div className="mt-3">
            <FieldLabel htmlFor="receivedQty">
              How much arrived, in {pending.unit}?
            </FieldLabel>
            <input
              className="rr-input mt-1 max-w-[12rem]"
              id="receivedQty"
              max={pending.committedQty}
              min="0"
              onChange={(event) =>
                setPending({ ...pending, qtyReceived: Number(event.target.value) })
              }
              type="number"
              value={pending.qtyReceived}
            />
          </div>
          <div className="mt-3">
            <FieldLabel htmlFor="receiptNote">Anything to add? (optional)</FieldLabel>
            <input
              className="rr-input mt-1"
              id="receiptNote"
              onChange={(event) => setPending({ ...pending, note: event.target.value })}
              value={pending.note}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void saveReceipt()}>
              {busy ? 'Saving…' : 'Yes, save this'}
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionHeading description="For example: we received 30 of the 50 meal packs.">
          Tell us what arrived, in your own words
        </SectionHeading>
        <label className="sr-only" htmlFor="spokenUpdate">
          Your update
        </label>
        <textarea
          className="rr-input"
          id="spokenUpdate"
          onChange={(event) => setSpokenUpdate(event.target.value)}
          rows={2}
          value={spokenUpdate}
        />
        <div className="mt-3">
          <Button disabled={!spokenUpdate.trim()} variant="secondary" onClick={interpretUpdate}>
            Read my update back to me
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Your words are turned into a proposed change, read back to you, and saved only after you
          confirm.
        </p>
      </Card>

      <Card>
        <SectionHeading>Add information for the coordinators</SectionHeading>
        <label className="sr-only" htmlFor="note">
          Note
        </label>
        <textarea
          className="rr-input"
          id="note"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything that has changed since you asked"
          rows={2}
          value={note}
        />
        <div className="mt-3">
          <Button disabled={busy || !note.trim()} onClick={() => void addNote()}>
            Add this note
          </Button>
        </div>
      </Card>

      {error ? <Alert tone="attention">{error}</Alert> : null}

      <Card>
        <SectionHeading description="Every change to your request, in order.">
          History
        </SectionHeading>
        <ol className="space-y-2">
          {request.timeline.map((event, index) => (
            <li className="border-b border-sand-200 pb-2 text-sm last:border-b-0" key={index}>
              <span className="font-semibold text-ink-900">
                {EVENT_LABELS[event.kind] ?? event.kind.replace(/_/g, ' ')}
              </span>
              <span className="ml-2 text-ink-500">
                {new Date(event.createdAt).toLocaleString()} · {event.actorKind.replace('_', ' ')}
              </span>
              {event.kind === 'receipt_confirmed' || event.kind === 'delivery_failed' ? (
                <span className="block text-ink-700">
                  {String(event.detail.receivedQty)} of {String(event.detail.committedQty)}{' '}
                  {String(event.detail.unit)} confirmed
                  {Number(event.detail.shortfallQty) > 0
                    ? `, ${String(event.detail.shortfallQty)} ${String(event.detail.unit)} short`
                    : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
