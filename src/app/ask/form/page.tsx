import Link from 'next/link';
import { RequestForm } from '@/components/RequestForm';
import { DISTRICT } from '@/lib/db/seed-data';
import { Alert, FictionalNotice } from '@/components/ui';

export const metadata = { title: 'Type your request — ReliefRelay' };

export default function FormPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Type your request</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          A short form. You do not need an account, and you can leave anything you do not know
          blank.
        </p>
      </div>

      <Alert tone="emergency" title="If anyone is in immediate danger">
        Call your local emergency services by phone. ReliefRelay cannot send a rescue team and does
        not contact responders on your behalf.
      </Alert>

      <RequestForm districtCentre={{ lat: DISTRICT.centerLat, lng: DISTRICT.centerLng }} />

      <p className="text-sm text-ink-500">
        Would you rather speak? <Link className="underline" href="/ask/voice">Use the voice assistant.</Link>
      </p>
      <FictionalNotice />
    </div>
  );
}
