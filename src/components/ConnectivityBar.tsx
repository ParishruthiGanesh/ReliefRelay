'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from './ui';
import { flushOutbox, listOutbox, removeItem, type OutboxItem } from '@/lib/client/outbox';

/**
 * Connectivity and synchronisation state, always visible when it matters.
 *
 * The wording is deliberate: an item that has not reached the server reads
 * "Saved on this device — not yet sent". It never says submitted, and it never
 * implies a relief team has seen it.
 */
export function ConnectivityBar() {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => setItems(listOutbox()), []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await flushOutbox();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = window.setInterval(refresh, 4000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(interval);
    };
  }, [refresh, sync]);

  const pending = items.filter((i) => i.status !== 'sent');
  const sent = items.filter((i) => i.status === 'sent');

  if (online && pending.length === 0 && sent.length === 0) return null;

  return (
    <div
      className="border-b border-sand-200 bg-sand-100 px-4 py-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={online ? 'good' : 'attention'}>{online ? 'Online' : 'Offline'}</Badge>

        {pending.length > 0 ? (
          <>
            <span className="font-semibold text-ember-700">
              {pending.length} {pending.length === 1 ? 'request' : 'requests'} saved on this device
              — not yet sent
            </span>
            <Button size="md" variant="secondary" onClick={sync} disabled={!online || syncing}>
              {syncing ? 'Sending…' : online ? 'Send now' : 'Waiting for a connection'}
            </Button>
          </>
        ) : null}

        {sent.length > 0 ? (
          <span className="text-ink-500">
            {sent.length} queued {sent.length === 1 ? 'request was' : 'requests were'} sent and
            acknowledged by the server
            {sent[0]?.result ? (
              <>
                {' '}
                (reference{' '}
                {sent.map((item) => item.result?.referenceCode).filter(Boolean).join(', ')})
              </>
            ) : null}
            .{' '}
            <button
              className="underline"
              onClick={() => {
                sent.forEach((item) => removeItem(item.id));
                refresh();
              }}
              type="button"
            >
              Clear
            </button>
          </span>
        ) : null}

        {pending.some((i) => i.status === 'failed') ? (
          <span className="text-ember-700">
            Last attempt failed: {pending.find((i) => i.status === 'failed')?.lastError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
