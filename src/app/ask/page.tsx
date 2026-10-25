import { LinkButton, Card, Alert } from '@/components/ui';

export const metadata = { title: 'Ask for help — ReliefRelay' };

/** Speak or type. Both paths lead to the same record. */
export default function AskPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Ask for help</h1>
        <p className="mt-2 max-w-2xl text-lg text-ink-700">
          Tell us what you need and where you are. You do not need an account.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col justify-between gap-4 border-teal-600/30">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">Speak</h2>
            <p className="mt-1 text-sm text-ink-700">
              Talk to the assistant. It will show you what it recorded, ask one or two short
              questions, read the request back to you, and submit only after you confirm. Everything
              it says is also shown as text.
            </p>
          </div>
          <LinkButton href="/ask/voice" size="lg">
            Speak to the assistant
          </LinkButton>
        </Card>

        <Card className="flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">Type</h2>
            <p className="mt-1 text-sm text-ink-700">
              A short form. Works on a slow connection, and saves on your device if you lose signal
              so you can send it when you are back online.
            </p>
          </div>
          <LinkButton href="/ask/form" size="lg" variant="secondary">
            Type your request
          </LinkButton>
        </Card>
      </div>

      <Alert tone="emergency" title="If someone is in immediate danger">
        Contact your local emergency services by phone now. ReliefRelay coordinates supplies and
        shelter — it cannot send a rescue team, and it does not contact responders for you.
      </Alert>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Asking on someone else&rsquo;s behalf?</h2>
        <p className="mt-1 text-sm text-ink-700">
          Both paths let you say you are a community representative or a coordinator submitting for
          someone else. The request is marked as such so a coordinator knows who to check with.
        </p>
      </Card>
    </div>
  );
}
