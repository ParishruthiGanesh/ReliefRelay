import Link from 'next/link';
import { Alert, Card, LinkButton } from '@/components/ui';

export const metadata = { title: 'Offline — ReliefRelay' };

/** Served from the cache when a navigation fails. */
export default function OfflinePage() {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold text-ink-900">You are offline</h1>

      <Alert tone="attention" title="What still works, and what does not">
        <ul className="mt-1 space-y-1">
          <li>
            • You can fill in the typed request form. It will be saved on this device and sent when
            you are back online.
          </li>
          <li>
            • Speaking will not work: transcription needs a connection. Typing records exactly the
            same information.
          </li>
          <li>
            • Shelter capacity and request statuses cannot be shown, because a cached figure would
            look current when it is not.
          </li>
        </ul>
      </Alert>

      <Card>
        <p className="font-semibold text-ink-900">
          Anything you have filled in is saved on this device — not yet sent.
        </p>
        <p className="mt-1 text-sm text-ink-700">
          Nothing has reached a relief team until the bar at the top of the page says the server
          acknowledged it and gives you a reference code. Retrying cannot create two requests.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/ask/form">Open the typed form</LinkButton>
          <Link className="self-center text-sm font-semibold text-teal-700 underline" href="/">
            Back to the start
          </Link>
        </div>
      </Card>

      <Alert tone="emergency" title="If anyone is in immediate danger">
        Call your local emergency services by phone. ReliefRelay cannot send help and has not
        contacted anyone for you.
      </Alert>
    </div>
  );
}
