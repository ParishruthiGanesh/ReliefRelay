'use client';

import { useState } from 'react';
import { Alert, Button, Card, FieldLabel, SectionHeading } from './ui';

/**
 * Correcting the request before it is submitted.
 *
 * The read-back used to offer only "Something is wrong", which sent another
 * conversational turn and hoped the extractor picked the change up. This lets
 * a person fix the fields directly — which is what someone does when they can
 * see the summary is wrong and want it right before they send it.
 *
 * Leaving an amount blank is a real answer, not an omission: it records that
 * the person does not know, and a coordinator confirms it later.
 */

const CATEGORIES = [
  { id: 'meal_packs', label: 'Meal packs', unit: 'packs' },
  { id: 'drinking_water', label: 'Drinking water', unit: 'litres' },
  { id: 'hygiene_kits', label: 'Hygiene kits', unit: 'kits' },
  { id: 'shelter_spaces', label: 'Shelter spaces', unit: 'spaces' },
];

export interface EditableDraft {
  items: Array<{ categoryId: string; quantity: number | null; unit: string; quantityUncertain: boolean }>;
  groupSize: number | null;
  urgency: string | null;
}

export function DraftEditor({
  draft,
  conversationId,
  onSaved,
  onCancel,
}: {
  draft: EditableDraft;
  conversationId: string;
  onSaved: (conversation: unknown) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      draft.items.map((i) => [i.categoryId, i.quantity === null ? '' : String(i.quantity)]),
    ),
  );
  const [groupSize, setGroupSize] = useState(draft.groupSize === null ? '' : String(draft.groupSize));
  const [urgency, setUrgency] = useState(draft.urgency ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (categoryId: string) =>
    setSelected((current) => {
      if (categoryId in current) {
        const next = { ...current };
        delete next[categoryId];
        return next;
      }
      return { ...current, [categoryId]: '' };
    });

  const save = async () => {
    setError(null);
    if (Object.keys(selected).length === 0) {
      setError('Keep at least one thing you need, or go back and cancel instead.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/conversation/${conversationId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: Object.entries(selected).map(([categoryId, value]) => ({
            categoryId,
            quantity: value.trim() === '' ? null : Number(value),
            quantityUncertain: value.trim() === '',
          })),
          groupSize: groupSize.trim() === '' ? null : Number(groupSize),
          urgency: urgency || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      onSaved(body.conversation);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-ember-500/40">
      <SectionHeading description="Change anything that is wrong, then check the summary again. Nothing is sent while you are editing.">
        Correct your request
      </SectionHeading>

      <div className="space-y-3">
        {CATEGORIES.map((category) => {
          const isOn = category.id in selected;
          return (
            <div className="rounded-xl border border-sand-200 p-3" key={category.id}>
              <label className="flex min-h-[44px] items-center gap-3 font-semibold text-ink-900">
                <input
                  checked={isOn}
                  className="h-6 w-6 rounded border-sand-300 text-teal-600 focus:ring-teal-600"
                  onChange={() => toggle(category.id)}
                  type="checkbox"
                />
                {category.label}
              </label>
              {isOn ? (
                <div className="mt-2 pl-9">
                  <FieldLabel htmlFor={`edit-${category.id}`}>
                    How many {category.unit}?
                  </FieldLabel>
                  <input
                    className="rr-input mt-1 max-w-[12rem]"
                    id={`edit-${category.id}`}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) =>
                      setSelected((current) => ({ ...current, [category.id]: event.target.value }))
                    }
                    placeholder={`in ${category.unit}`}
                    type="number"
                    value={selected[category.id]}
                  />
                  <p className="rr-hint">
                    Leave blank if you do not know — it stays unknown and a coordinator will
                    confirm it with you.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="edit-group" hint="People, not supplies.">
            How many people is this for?
          </FieldLabel>
          <input
            className="rr-input mt-1"
            id="edit-group"
            inputMode="numeric"
            min="1"
            onChange={(event) => setGroupSize(event.target.value)}
            type="number"
            value={groupSize}
          />
        </div>
        <div>
          <FieldLabel htmlFor="edit-urgency">How urgent is it?</FieldLabel>
          <select
            className="rr-input mt-1"
            id="edit-urgency"
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
      </div>

      {error ? (
        <div className="mt-4">
          <Alert tone="attention">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save these changes'}
        </Button>
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </Card>
  );
}
