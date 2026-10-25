'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, FieldLabel, Provenance, SectionHeading } from './ui';

/**
 * A facility representative's voice or typed update.
 *
 * "We have ten spaces left and enough drinking water until this evening."
 * The fields are extracted, the essentials are asked for if missing, the whole
 * thing is read back, and it is saved only after confirmation — and only if
 * this account is registered for this facility.
 */

interface Facility {
  id: string;
  name: string;
  kind: string;
  capacityAvailable: number | null;
  capacityTotal: number | null;
  openingStatus: string;
  lastUpdateAge: string;
  freshness: 'fresh' | 'ageing' | 'stale' | 'expired';
  lastUpdateSource: string | null;
  resourcesNote: string | null;
}

interface Proposed {
  capacityAvailable: number | null;
  openingStatus: 'open' | 'full' | 'closed' | null;
  resourcesNote: string | null;
  note: string | null;
}

/** Reads the fields out of a spoken or typed sentence. Nothing is guessed. */
function extractFacilityUpdate(text: string): { proposed: Proposed; missing: string[] } {
  const lower = text.toLowerCase();
  const spaces = lower.match(/\b(\d{1,5})\s*(?:spaces?|beds?|places?|spots?)\b/);
  const noSpaces = /\b(no spaces?|full|nothing left|no room|no beds?)\b/.test(lower);
  const closed = /\b(closed|closing|shut)\b/.test(lower);

  const capacityAvailable = noSpaces ? 0 : spaces ? Number(spaces[1]) : null;
  const openingStatus: Proposed['openingStatus'] = closed
    ? 'closed'
    : noSpaces
      ? 'full'
      : capacityAvailable !== null && capacityAvailable > 0
        ? 'open'
        : null;

  // Resource mentions are kept as the representative's own words rather than
  // being turned into quantities nobody stated.
  const resourceSentence = text
    .split(/[.;]/)
    .map((part) => part.trim())
    .find((part) => /\b(water|food|meals?|hygiene|kits?|supplies|blankets?)\b/i.test(part));

  const missing: string[] = [];
  if (capacityAvailable === null && openingStatus === null) missing.push('capacity');

  return {
    proposed: {
      capacityAvailable,
      openingStatus,
      resourcesNote: resourceSentence ?? null,
      note: text,
    },
    missing,
  };
}

export function FacilityUpdatePanel({ facilityId }: { facilityId: string }) {
  const [facility, setFacility] = useState<Facility | null>(null);
  const [text, setText] = useState('');
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recognitionAvailable, setRecognitionAvailable] = useState(false);
  const [listening, setListening] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/facilities');
    if (!response.ok) return;
    const body = await response.json();
    setFacility((body.facilities ?? []).find((f: Facility) => f.id === facilityId) ?? null);
  }, [facilityId]);

  useEffect(() => {
    void load();
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setRecognitionAvailable(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, [load]);

  const listen = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        start(): void;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onend: (() => void) | null;
        onerror: ((e: { error?: string }) => void) | null;
      };
      webkitSpeechRecognition?: new () => never;
    };
    const Recognition = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          start(): void;
          onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
          onend: (() => void) | null;
          onerror: ((e: { error?: string }) => void) | null;
        })
      | undefined;
    if (!Recognition) return;
    const instance = new Recognition();
    instance.lang = 'en-GB';
    instance.onresult = (event) => {
      const heard = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript).join(' ');
      setText(heard.trim());
    };
    instance.onerror = (event) => {
      setError(`Your browser's speech recognition reported "${event.error ?? 'an error'}". Nothing was transcribed.`);
      setListening(false);
    };
    instance.onend = () => setListening(false);
    setListening(true);
    instance.start();
  };

  const save = async () => {
    if (!proposed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/facility/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          facilityId,
          capacityAvailable: proposed.capacityAvailable,
          openingStatus: proposed.openingStatus,
          resourcesNote: proposed.resourcesNote,
          note: proposed.note,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      setFacility(body.facility);
      setProposed(null);
      setText('');
      setNotice('Saved. The directory now shows this figure as facility-confirmed, just now.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {facility ? (
        <Card>
          <SectionHeading>{facility.name}</SectionHeading>
          <p className="text-sm text-ink-700">
            Currently showing{' '}
            <strong>
              {facility.capacityAvailable ?? 'unknown'}
              {facility.capacityTotal ? ` of ${facility.capacityTotal}` : ''} spaces
            </strong>{' '}
            · {facility.openingStatus}
          </p>
          {facility.resourcesNote ? (
            <p className="text-sm text-ink-700">{facility.resourcesNote}</p>
          ) : null}
          <p className="mt-2">
            <Provenance
              age={facility.lastUpdateAge}
              freshness={facility.freshness}
              sourceLabel={
                facility.lastUpdateSource === 'facility_confirmed'
                  ? 'Facility confirmed'
                  : 'Coordinator reviewed'
              }
            />
          </p>
          {facility.freshness === 'stale' ? (
            <p className="mt-2 text-sm text-ember-700">
              This figure is shown to the public as stale. An update now would change that.
            </p>
          ) : null}
        </Card>
      ) : null}

      {notice ? <Alert tone="good">{notice}</Alert> : null}
      {error ? <Alert tone="attention">{error}</Alert> : null}

      <Card>
        <SectionHeading description="For example: we have ten spaces left and enough drinking water until this evening.">
          Say or type what has changed
        </SectionHeading>
        <label className="sr-only" htmlFor="facility-text">
          Your update
        </label>
        <textarea
          className="rr-input"
          id="facility-text"
          onChange={(event) => setText(event.target.value)}
          rows={3}
          value={text}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {recognitionAvailable ? (
            <Button disabled={listening} variant="secondary" onClick={listen}>
              {listening ? '● Listening…' : 'Speak instead'}
            </Button>
          ) : (
            <Badge tone="neutral">This browser has no speech recognition — typing works the same</Badge>
          )}
          <Button
            disabled={!text.trim()}
            onClick={() => {
              const result = extractFacilityUpdate(text);
              setProposed(result.proposed);
              setMissing(result.missing);
              setError(null);
            }}
          >
            Read it back to me
          </Button>
        </div>
      </Card>

      {proposed ? (
        <Card className="border-teal-600/40">
          <SectionHeading description="Nothing is saved until you confirm this.">
            Please check this is right
          </SectionHeading>
          {missing.length > 0 ? (
            <Alert tone="attention" title="One thing is missing">
              I did not hear how many spaces are left. Add it below, or save the note on its own and
              a coordinator will follow up.
            </Alert>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="p-spaces">Spaces available</FieldLabel>
              <input
                className="rr-input mt-1"
                id="p-spaces"
                min="0"
                onChange={(event) =>
                  setProposed({
                    ...proposed,
                    capacityAvailable: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
                placeholder="not stated"
                type="number"
                value={proposed.capacityAvailable ?? ''}
              />
            </div>
            <div>
              <FieldLabel htmlFor="p-status">Opening status</FieldLabel>
              <select
                className="rr-input mt-1"
                id="p-status"
                onChange={(event) =>
                  setProposed({
                    ...proposed,
                    openingStatus: (event.target.value || null) as Proposed['openingStatus'],
                  })
                }
                value={proposed.openingStatus ?? ''}
              >
                <option value="">Leave unchanged</option>
                <option value="open">Open</option>
                <option value="full">Full</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="p-resources" hint="Kept as your own words. It is not turned into a stock quantity nobody counted.">
                Supplies note
              </FieldLabel>
              <input
                className="rr-input mt-1"
                id="p-resources"
                onChange={(event) => setProposed({ ...proposed, resourcesNote: event.target.value })}
                value={proposed.resourcesNote ?? ''}
              />
            </div>
          </div>
          <p className="mt-3 text-[0.95rem] text-ink-900">
            Saving this will show{' '}
            <strong>
              {proposed.capacityAvailable ?? 'the current figure'}
              {proposed.capacityAvailable !== null ? ' spaces available' : ''}
            </strong>
            {proposed.openingStatus ? ` and the status as ${proposed.openingStatus}` : ''}, confirmed
            by you, just now.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Yes, save this'}
            </Button>
            <Button variant="ghost" onClick={() => setProposed(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
