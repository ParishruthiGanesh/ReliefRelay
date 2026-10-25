'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, FieldLabel, SectionHeading } from './ui';
import { newIdempotencyKey } from '@/lib/client/outbox';

const CATEGORIES = [
  { id: 'meal_packs', label: 'Meal packs', unit: 'packs' },
  { id: 'drinking_water', label: 'Drinking water', unit: 'litres' },
  { id: 'hygiene_kits', label: 'Hygiene kits', unit: 'kits' },
  { id: 'shelter_spaces', label: 'Shelter spaces', unit: 'spaces' },
];

/**
 * A donor publishes availability.
 *
 * This records an offer for coordinator review. The form says so plainly,
 * because an offer sitting in a review queue is not stock a shelter can
 * count on.
 */
export function OfferForm() {
  const [categoryId, setCategoryId] = useState('meal_packs');
  const [qty, setQty] = useState('');
  const [generalLocation, setGeneralLocation] = useState('');
  const [availableFrom, setAvailableFrom] = useState('');
  const [availableUntil, setAvailableUntil] = useState('');
  const [handover, setHandover] = useState('either');
  const [storageNote, setStorageNote] = useState('');
  const [expiryNote, setExpiryNote] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactMethod, setContactMethod] = useState('phone');
  const [contactValue, setContactValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const unit = CATEGORIES.find((c) => c.id === categoryId)?.unit ?? '';

  const submit = async () => {
    setError(null);
    if (!qty || Number(qty) <= 0) {
      setError('Enter how much you can provide.');
      return;
    }
    if (generalLocation.trim().length < 2) {
      setError('Tell us roughly where the supplies are.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: newIdempotencyKey(),
          categoryId,
          qty: Number(qty),
          generalLocation: generalLocation.trim(),
          availableFrom: availableFrom || undefined,
          availableUntil: availableUntil || undefined,
          handover,
          storageNote: storageNote || undefined,
          expiryNote: expiryNote || undefined,
          contactName: contactName || undefined,
          contactMethod,
          contactValue: contactValue || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'The offer could not be recorded.');
      setDone(body.message);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Alert tone="good" title="Offer recorded">
        <p>{done}</p>
      </Alert>
    );
  }

  return (
    <Card>
      <SectionHeading description="Quantities are recorded in a single unit per category, so nothing gets mixed up later.">
        What can you provide?
      </SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="category">Category</FieldLabel>
          <select
            className="rr-input mt-1"
            id="category"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label} (in {category.unit})
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="qty" hint={`Recorded in ${unit}. Nothing is converted.`}>
            How much, in {unit}?
          </FieldLabel>
          <input
            className="rr-input mt-1"
            id="qty"
            inputMode="numeric"
            min="1"
            onChange={(event) => setQty(event.target.value)}
            type="number"
            value={qty}
          />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor="where" hint="A general area is enough; a coordinator will agree the exact handover with you.">
            Where are the supplies?
          </FieldLabel>
          <input
            className="rr-input mt-1"
            id="where"
            onChange={(event) => setGeneralLocation(event.target.value)}
            placeholder="For example: Southgate Industrial Estate"
            value={generalLocation}
          />
        </div>
        <div>
          <FieldLabel htmlFor="from">Available from (optional)</FieldLabel>
          <input
            className="rr-input mt-1"
            id="from"
            onChange={(event) => setAvailableFrom(event.target.value)}
            placeholder="For example: today 14:00"
            value={availableFrom}
          />
        </div>
        <div>
          <FieldLabel htmlFor="until">Available until (optional)</FieldLabel>
          <input
            className="rr-input mt-1"
            id="until"
            onChange={(event) => setAvailableUntil(event.target.value)}
            placeholder="For example: tomorrow 18:00"
            value={availableUntil}
          />
        </div>
        <div>
          <FieldLabel htmlFor="handover">Collection or delivery?</FieldLabel>
          <select
            className="rr-input mt-1"
            id="handover"
            onChange={(event) => setHandover(event.target.value)}
            value={handover}
          >
            <option value="either">Either</option>
            <option value="collection">Collection only</option>
            <option value="delivery">We can deliver</option>
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="storage">Storage requirements (optional)</FieldLabel>
          <input
            className="rr-input mt-1"
            id="storage"
            onChange={(event) => setStorageNote(event.target.value)}
            placeholder="For example: keep dry, pallets of 20"
            value={storageNote}
          />
        </div>
        <div>
          <FieldLabel htmlFor="expiry">Expiry information (optional)</FieldLabel>
          <input
            className="rr-input mt-1"
            id="expiry"
            onChange={(event) => setExpiryNote(event.target.value)}
            placeholder="For example: best before in 3 weeks"
            value={expiryNote}
          />
        </div>
        <div>
          <FieldLabel htmlFor="contactName">Your name or organisation (optional)</FieldLabel>
          <input
            className="rr-input mt-1"
            id="contactName"
            onChange={(event) => setContactName(event.target.value)}
            value={contactName}
          />
        </div>
        <div>
          <FieldLabel htmlFor="contactValue" hint="Coordinators only. Never published and never written to the blockchain record.">
            How can a coordinator reach you?
          </FieldLabel>
          <div className="mt-1 flex gap-2">
            <select
              aria-label="Contact method"
              className="rr-input max-w-[9rem]"
              onChange={(event) => setContactMethod(event.target.value)}
              value={contactMethod}
            >
              <option value="phone">Phone</option>
              <option value="sms">Text</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
            <input
              className="rr-input"
              id="contactValue"
              onChange={(event) => setContactValue(event.target.value)}
              value={contactValue}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert tone="attention">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void submit()} size="lg">
          {busy ? 'Recording…' : 'Record my offer'}
        </Button>
        <Badge tone="neutral">An offer is not counted as stock until a coordinator accepts it</Badge>
      </div>
    </Card>
  );
}
