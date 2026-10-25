'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, FieldLabel, SectionHeading } from './ui';
import {
  clearLocalDraft,
  enqueue,
  flushOutbox,
  loadLocalDraft,
  newIdempotencyKey,
  saveLocalDraft,
} from '@/lib/client/outbox';

/**
 * The typed request form.
 *
 * Short on purpose, and text-first so it works on a weak connection. If the
 * send fails or the device is offline it goes to the local outbox and the UI
 * says "Saved on this device — not yet sent" rather than anything that sounds
 * like it arrived.
 */

const CATEGORIES = [
  { id: 'meal_packs', label: 'Meal packs', unit: 'packs' },
  { id: 'drinking_water', label: 'Drinking water', unit: 'litres' },
  { id: 'hygiene_kits', label: 'Hygiene kits', unit: 'kits' },
  { id: 'shelter_spaces', label: 'Shelter spaces', unit: 'spaces' },
];

interface Facility {
  id: string;
  name: string;
  kind: string;
}

interface Selection {
  categoryId: string;
  quantity: string;
}

const DRAFT_SCOPE = 'form';

export function RequestForm() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [locationText, setLocationText] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [urgency, setUrgency] = useState('');
  const [behalfRole, setBehalfRole] = useState('self');
  const [contactMethod, setContactMethod] = useState('none');
  const [contactValue, setContactValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [result, setResult] = useState<{
    referenceCode: string;
    trackingToken: string;
    status: string;
    missingFields: string[];
  } | null>(null);

  useEffect(() => {
    void fetch('/api/facilities')
      .then((r) => r.json())
      .then((body) => setFacilities(body.facilities ?? []))
      .catch(() => setFacilities([]));
  }, []);

  // Restore an unsent draft from this device.
  useEffect(() => {
    const stored = loadLocalDraft<{ scope?: string; locationText?: string; selections?: Selection[]; groupSize?: string; note?: string }>();
    if (stored?.value?.scope === DRAFT_SCOPE) {
      setLocationText(stored.value.locationText ?? '');
      setSelections(stored.value.selections ?? []);
      setGroupSize(stored.value.groupSize ?? '');
      setNote(stored.value.note ?? '');
    }
  }, []);

  useEffect(() => {
    if (result) return;
    saveLocalDraft({ scope: DRAFT_SCOPE, locationText, selections, groupSize, note });
  }, [groupSize, locationText, note, result, selections]);

  const toggle = (categoryId: string) => {
    setSelections((current) =>
      current.some((s) => s.categoryId === categoryId)
        ? current.filter((s) => s.categoryId !== categoryId)
        : [...current, { categoryId, quantity: '' }],
    );
  };

  const submit = async () => {
    setError(null);
    if (selections.length === 0) {
      setError('Choose at least one thing you need.');
      return;
    }
    if (locationText.trim().length < 2 && !facilityId) {
      setError('Tell us where you are, or choose a place from the list.');
      return;
    }

    const payload = {
      language: 'en' as const,
      behalfRole,
      intent: 'need' as const,
      locationText: locationText.trim() || facilities.find((f) => f.id === facilityId)?.name || '',
      facilityId: facilityId || undefined,
      groupSize: groupSize ? Number(groupSize) : null,
      items: selections.map((s) => ({
        categoryId: s.categoryId,
        // An empty box stays unknown. It is never filled in from the group size.
        quantity: s.quantity.trim() === '' ? null : Number(s.quantity),
        quantityUncertain: s.quantity.trim() === '',
      })),
      urgency: urgency || null,
      contactMethod: contactMethod as 'phone' | 'whatsapp' | 'sms' | 'none',
      contactValue: contactValue.trim() || null,
      note: note.trim() || undefined,
      dangerReported: false,
      acceptIncomplete: true,
    };

    const key = newIdempotencyKey();
    setBusy(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueue('/api/requests', payload, key);
        setQueued(true);
        return;
      }
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: key }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'The request could not be sent.');
      setResult(body.result);
      clearLocalDraft();
    } catch (caught) {
      // The server never acknowledged it, so it is queued with the same key:
      // a later retry produces the same request, not a second one.
      enqueue('/api/requests', payload, key);
      setQueued(true);
      setError(
        `${(caught as Error).message} Your request has been saved on this device and will be sent when a connection is available.`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <Alert tone="good" title="Submitted">
          Your request has been submitted. Your reference is <strong>{result.referenceCode}</strong>.
          A coordinator has not yet accepted it.
        </Alert>
        <Card>
          <SectionHeading description="Keep this link. It is the only way to open your request.">
            Your private tracking link
          </SectionHeading>
          <p className="break-all rounded-xl bg-sand-100 p-3 font-mono text-sm">
            {typeof window !== 'undefined' ? window.location.origin : ''}/track/{result.trackingToken}
          </p>
          <Link
            className="mt-3 inline-flex min-h-[48px] items-center rounded-xl bg-teal-600 px-4 font-semibold text-white"
            href={`/track/${result.trackingToken}`}
          >
            Open my request
          </Link>
          {result.missingFields.length > 0 ? (
            <p className="mt-3 text-sm text-ember-700">
              A coordinator will see this is still missing: {result.missingFields.join(', ')}.
            </p>
          ) : null}
        </Card>
      </div>
    );
  }

  if (queued) {
    return (
      <Alert tone="attention" title="Saved on this device — not yet sent">
        <p>
          Your request has <strong>not</strong> reached the coordination team yet. It is stored in
          this browser and will be sent as soon as you have a connection; the bar at the top of the
          page shows the state and lets you retry. Sending it twice cannot create two requests.
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeading description="Choose everything you need. If you do not know how much, leave the amount blank — a coordinator will work it out with you.">
          What do you need?
        </SectionHeading>
        <div className="space-y-3">
          {CATEGORIES.map((category) => {
            const selected = selections.find((s) => s.categoryId === category.id);
            return (
              <div className="rounded-xl border border-sand-200 p-3" key={category.id}>
                <label className="flex min-h-[44px] items-center gap-3 font-semibold text-ink-900">
                  <input
                    checked={!!selected}
                    className="h-6 w-6 rounded border-sand-300 text-teal-600 focus:ring-teal-600"
                    onChange={() => toggle(category.id)}
                    type="checkbox"
                  />
                  {category.label}
                </label>
                {selected ? (
                  <div className="mt-2 pl-9">
                    <FieldLabel htmlFor={`qty-${category.id}`}>
                      How many {category.unit}? (optional)
                    </FieldLabel>
                    <input
                      className="rr-input mt-1 max-w-[12rem]"
                      id={`qty-${category.id}`}
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        setSelections((current) =>
                          current.map((s) =>
                            s.categoryId === category.id
                              ? { ...s, quantity: event.target.value }
                              : s,
                          ),
                        )
                      }
                      placeholder={`in ${category.unit}`}
                      type="number"
                      value={selected.quantity}
                    />
                    <p className="rr-hint">
                      Leave blank if you do not know. It will stay blank — nothing is guessed from
                      the number of people.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionHeading>Where are you?</SectionHeading>
        <FieldLabel htmlFor="locationText" hint="A place name, a street, or a landmark.">
          In your own words
        </FieldLabel>
        <input
          className="rr-input mt-1"
          id="locationText"
          onChange={(event) => setLocationText(event.target.value)}
          placeholder="For example: the school near the old bridge"
          value={locationText}
        />
        <div className="mt-3">
          <FieldLabel
            htmlFor="facility"
            hint="If you are at one of these, choosing it here confirms the place exactly."
          >
            Or choose a known place
          </FieldLabel>
          <select
            className="rr-input mt-1"
            id="facility"
            onChange={(event) => setFacilityId(event.target.value)}
            value={facilityId}
          >
            <option value="">Not one of these</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name} ({facility.kind === 'shelter' ? 'shelter' : 'supply hub'})
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <SectionHeading>A few details</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="groupSize" hint="People, not supplies.">
              How many people is this for? (optional)
            </FieldLabel>
            <input
              className="rr-input mt-1"
              id="groupSize"
              inputMode="numeric"
              min="1"
              onChange={(event) => setGroupSize(event.target.value)}
              type="number"
              value={groupSize}
            />
          </div>
          <div>
            <FieldLabel htmlFor="urgency">How urgent is it? (optional)</FieldLabel>
            <select
              className="rr-input mt-1"
              id="urgency"
              onChange={(event) => setUrgency(event.target.value)}
              value={urgency}
            >
              <option value="">Not stated</option>
              <option value="low">Can wait</option>
              <option value="normal">Normal</option>
              <option value="high">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="behalf">Who is asking?</FieldLabel>
            <select
              className="rr-input mt-1"
              id="behalf"
              onChange={(event) => setBehalfRole(event.target.value)}
              value={behalfRole}
            >
              <option value="self">I need help myself</option>
              <option value="community_rep">I am a community representative</option>
              <option value="coordinator">I am a coordinator submitting for someone</option>
              <option value="facility_rep">I represent a shelter or facility</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="contactMethod" hint="Only coordinators can see this. It is never shown publicly and never written to the blockchain record.">
              How can a coordinator reach you? (optional)
            </FieldLabel>
            <select
              className="rr-input mt-1"
              id="contactMethod"
              onChange={(event) => setContactMethod(event.target.value)}
              value={contactMethod}
            >
              <option value="none">Do not contact me</option>
              <option value="phone">Phone call</option>
              <option value="sms">Text message</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            {contactMethod !== 'none' ? (
              <input
                className="rr-input mt-2"
                onChange={(event) => setContactValue(event.target.value)}
                placeholder="Number or handle"
                value={contactValue}
              />
            ) : null}
          </div>
        </div>
        <div className="mt-4">
          <FieldLabel htmlFor="note">Anything else a coordinator should know? (optional)</FieldLabel>
          <textarea
            className="rr-input mt-1"
            id="note"
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            value={note}
          />
        </div>
      </Card>

      {error ? <Alert tone="attention">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void submit()} size="lg">
          {busy ? 'Sending…' : 'Submit my request'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void flushOutbox();
          }}
        >
          Retry anything saved on this device
        </Button>
        <Badge tone="neutral">Nothing is submitted until the server confirms it</Badge>
      </div>
    </div>
  );
}
