'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, SectionHeading, Spinner } from './ui';

interface Suggestion {
  id: string;
  score: number;
  reasons: string[];
  status: string;
  requestA: { id: string; referenceCode: string; locationText: string; createdAt: string };
  requestB: { id: string; referenceCode: string; locationText: string; createdAt: string };
}

/**
 * The duplicate review queue.
 *
 * Confirming a duplicate records a human judgement on both request timelines.
 * It does not merge, hide, cancel or deprioritise either request — two families
 * at the same shelter asking for water are not one request, and getting that
 * wrong costs someone their supplies.
 */
export function DuplicateQueue() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/coordinator/duplicates');
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load the queue.');
      setSuggestions(body.suggestions ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (candidateId: string, decision: 'confirmed_duplicate' | 'not_duplicate') => {
    setBusy(true);
    try {
      const response = await fetch('/api/coordinator/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, decision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      setSuggestions(body.suggestions ?? []);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Looking for possible duplicates…" />;

  return (
    <div className="space-y-4">
      <Alert tone="info" title="These are suggestions, not actions">
        Nothing is merged, hidden, deleted or deprioritised automatically. Marking a pair as
        duplicates records your judgement on both request timelines; closing one stays a separate,
        deliberate decision.
      </Alert>

      {error ? <Alert tone="attention">{error}</Alert> : null}

      {suggestions.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-500">No possible duplicates are waiting for review.</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {suggestions.map((suggestion) => (
            <Card as="li" key={suggestion.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">Similarity {Math.round(suggestion.score * 100)}%</Badge>
                <SectionHeading>
                  {suggestion.requestA.referenceCode} and {suggestion.requestB.referenceCode}
                </SectionHeading>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[suggestion.requestA, suggestion.requestB].map((request) => (
                  <div className="rounded-xl border border-sand-200 p-3 text-sm" key={request.id}>
                    <a className="font-semibold text-teal-700 underline" href={`/coordinator/requests/${request.id}`}>
                      {request.referenceCode}
                    </a>
                    <p className="text-ink-700">{request.locationText}</p>
                    <p className="text-xs text-ink-500">
                      {new Date(request.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-0.5 text-sm text-ink-700">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() => void decide(suggestion.id, 'confirmed_duplicate')}
                >
                  These are the same situation
                </Button>
                <Button disabled={busy} variant="ghost" onClick={() => void decide(suggestion.id, 'not_duplicate')}>
                  These are different — stop suggesting
                </Button>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
