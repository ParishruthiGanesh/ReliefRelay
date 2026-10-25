import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api/http';
import { VolunteerAssignments } from '@/components/VolunteerAssignments';
import { Alert, FictionalNotice } from '@/components/ui';

export const metadata = { title: 'My deliveries — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default async function VolunteerPage() {
  const user = await currentUser();
  if (!user || user.role !== 'volunteer') redirect('/login');

  if (!user.isApproved) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-ink-900">My deliveries</h1>
        <Alert tone="attention" title="Your volunteer account has not been approved yet">
          Only approved volunteers can be assigned a delivery. This is enforced by the backend, not
          just hidden in the interface: an attempt to assign a delivery to an unapproved account is
          refused.
        </Alert>
        <FictionalNotice />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">My deliveries</h1>
        <p className="mt-1 text-ink-700">
          Signed in as {user.displayName}. You see only the assignments given to you.
        </p>
      </div>
      <VolunteerAssignments />
      <FictionalNotice />
    </div>
  );
}
