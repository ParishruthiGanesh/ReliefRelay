import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { DuplicateQueue } from '@/components/DuplicateQueue';
import { FictionalNotice } from '@/components/ui';

export const metadata = { title: 'Possible duplicates — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default async function DuplicatesPage() {
  const user = await currentUser();
  if (!user || user.role !== 'coordinator') redirect('/login');

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-semibold text-teal-700 underline" href="/coordinator">
          ← Back to the dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink-900">Possible duplicate reports</h1>
        <p className="mt-1 text-ink-700">
          Pairs of requests that look like they may describe the same situation.
        </p>
      </div>
      <DuplicateQueue />
      <FictionalNotice />
    </div>
  );
}
