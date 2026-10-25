'use client';

import { useState } from 'react';
import { Button } from './ui';

/** Retries queued attestations by hand, for the demonstration. */
export function AttestationFlushButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        disabled={busy}
        variant="secondary"
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const response = await fetch('/api/coordinator/actions', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'flush_attestations' }),
            });
            const body = await response.json();
            const chain = body.chain;
            setMessage(
              chain?.skippedReason
                ? `Still queued: ${chain.skippedReason}`
                : `Attempted ${chain?.attempted ?? 0}, confirmed ${chain?.confirmed ?? 0}, failed ${chain?.failed ?? 0}.`,
            );
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Retrying…' : 'Retry pending attestations'}
      </Button>
      {message ? <span className="text-sm text-ink-700">{message}</span> : null}
    </span>
  );
}
