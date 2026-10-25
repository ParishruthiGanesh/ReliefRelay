import Link from 'next/link';
import { OfferForm } from '@/components/OfferForm';
import { Card, FictionalNotice, SectionHeading } from '@/components/ui';

export const metadata = { title: 'Offer supplies or volunteer — ReliefRelay' };

export default function OfferPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Offer supplies or volunteer</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          Publish what you can provide, so coordinators can match it against what is actually
          unmet.
        </p>
      </div>

      <OfferForm />

      <Card>
        <SectionHeading description="Deliveries are assigned by a coordinator to volunteers who have been approved in advance.">
          Volunteering for deliveries
        </SectionHeading>
        <p className="text-sm text-ink-700">
          In this prototype the approved volunteer pool is fixed and fictional, and a volunteer can
          only see the assignments given to them. Approved volunteers sign in to see their own work.
        </p>
        <p className="mt-2 text-sm text-ink-700">
          An unapproved volunteer account cannot be assigned a delivery at all — the backend refuses
          it, not just the interface.
        </p>
        <Link className="mt-3 inline-block font-semibold text-teal-700 underline" href="/login">
          Volunteer sign in
        </Link>
      </Card>

      <FictionalNotice />
    </div>
  );
}
