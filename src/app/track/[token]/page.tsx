import { TrackingPanel } from '@/components/TrackingPanel';
import { FictionalNotice } from '@/components/ui';

export const metadata = { title: 'Your request — ReliefRelay', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="space-y-5">
      <TrackingPanel token={token} />
      <FictionalNotice />
    </div>
  );
}
