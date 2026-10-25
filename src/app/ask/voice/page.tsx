import Link from 'next/link';
import { VoiceAssistant } from '@/components/VoiceAssistant';
import { languageSupport } from '@/lib/providers/languages';
import { Alert, FictionalNotice } from '@/components/ui';

export const metadata = { title: 'Speak to the assistant — ReliefRelay' };
export const dynamic = 'force-dynamic';

export default function VoicePage() {
  const languages = languageSupport();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Speak to the assistant</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          Say what you need and where you are. The assistant will show you what it recorded, ask at
          most a few short questions, read the request back, and submit only when you say so.
        </p>
      </div>

      <Alert tone="emergency" title="If anyone is in immediate danger">
        Call your local emergency services by phone. ReliefRelay cannot send a rescue team and does
        not contact responders on your behalf.
      </Alert>

      <VoiceAssistant languages={languages} />

      <p className="text-sm text-ink-500">
        Prefer to type? <Link className="underline" href="/ask/form">Use the short form instead.</Link>
      </p>
      <FictionalNotice />
    </div>
  );
}
