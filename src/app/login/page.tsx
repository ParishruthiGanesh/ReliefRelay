'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, FieldLabel, SectionHeading } from '@/components/ui';

const DEMO_ACCOUNTS = [
  { email: 'coordinator@reliefrelay.test', password: 'coordinator-demo', role: 'Coordinator', goes: '/coordinator' },
  { email: 'coordinator2@reliefrelay.test', password: 'coordinator-demo', role: 'Second coordinator (for the concurrency demo)', goes: '/coordinator' },
  { email: 'shelter@reliefrelay.test', password: 'shelter-demo', role: 'Shelter representative', goes: '/facility' },
  { email: 'volunteer1@reliefrelay.test', password: 'volunteer-demo', role: 'Approved volunteer', goes: '/volunteer' },
  { email: 'volunteer3@reliefrelay.test', password: 'volunteer-demo', role: 'Volunteer awaiting approval', goes: '/volunteer' },
];

const LANDING: Record<string, string> = {
  coordinator: '/coordinator',
  facility_rep: '/facility',
  volunteer: '/volunteer',
  donor: '/offer',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (withEmail = email, withPassword = password) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: withEmail, password: withPassword }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Sign in failed.');
      router.push(LANDING[body.user.role] ?? '/');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Team sign in</h1>
        <p className="mt-2 text-ink-700">
          For coordinators, shelter representatives, approved volunteers and donor organisations.
          Members of the public never need an account to ask for help.
        </p>
      </div>

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <input
            autoComplete="username"
            className="rr-input mt-1"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          <div className="mt-3">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <input
              autoComplete="current-password"
              className="rr-input mt-1"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>
          {error ? (
            <div className="mt-4">
              <Alert tone="attention">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-4">
            <Button disabled={busy} size="lg" type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="border-dashed">
        <SectionHeading description="All of these accounts and the people they represent are fictional. Passwords are printed by the seed script and are not secrets.">
          Demonstration accounts
        </SectionHeading>
        <ul className="space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <li className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 pb-2 last:border-b-0" key={account.email}>
              <span className="text-sm">
                <strong>{account.role}</strong>
                <br />
                <span className="font-mono text-xs">{account.email}</span>
              </span>
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() => void signIn(account.email, account.password)}
              >
                Sign in as this
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
