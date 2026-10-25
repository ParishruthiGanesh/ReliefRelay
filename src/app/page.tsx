import Link from 'next/link';
import { getDb } from '@/lib/db';
import { listAdvisories } from '@/lib/domain/advisories';
import { Badge, Card, FictionalNotice, LinkButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The public home screen.
 *
 * Three large actions, nothing competing with them. No decorative statistics,
 * no invented live activity counter, no testimonials.
 */
export default async function HomePage() {
  const advisories = listAdvisories(getDb())
    .filter((a) => a.status === 'active')
    .slice(0, 1);
  const advisory = advisories[0];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold text-ink-900 sm:text-4xl">
          Tell us what you need.
          <br />
          Help teams coordinate the response.
        </h1>
        <p className="max-w-2xl text-lg text-ink-700">
          ReliefRelay turns scattered calls and messages about a flood into one shared picture of
          what is needed, what has been promised, and what has actually arrived.
        </p>
      </section>

      {advisory ? (
        <Card className="border-l-4 border-l-ember-500">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="attention">{advisory.severity}</Badge>
            {advisory.isSimulated ? <Badge tone="simulated">Simulated advisory</Badge> : null}
            <span className="text-xs text-ink-500">
              {advisory.source_name} · published {new Date(advisory.published_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-2 font-semibold text-ink-900">{advisory.headline}</p>
          <p className="mt-1 text-sm text-ink-700">{advisory.coverage_label}</p>
          <Link className="mt-2 inline-block text-sm font-semibold text-teal-700 underline" href="/advisories">
            All advisories, with sources and expiry times
          </Link>
        </Card>
      ) : null}

      <section aria-labelledby="actions" className="space-y-4">
        <h2 className="sr-only" id="actions">
          What would you like to do?
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="flex flex-col justify-between gap-4 border-teal-600/30">
            <div>
              <h3 className="text-xl font-semibold text-ink-900">Ask for help</h3>
              <p className="mt-1 text-sm text-ink-700">
                Speak or type what you need. No account and no crypto wallet required.
              </p>
            </div>
            <LinkButton href="/ask" size="lg">
              Ask for help
            </LinkButton>
          </Card>

          <Card className="flex flex-col justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-ink-900">Find supplies or shelter</h3>
              <p className="mt-1 text-sm text-ink-700">
                Shelters and supply hubs, with when each figure was last confirmed.
              </p>
            </div>
            <LinkButton href="/find" size="lg" variant="secondary">
              Find supplies or shelter
            </LinkButton>
          </Card>

          <Card className="flex flex-col justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-ink-900">Offer supplies or volunteer</h3>
              <p className="mt-1 text-sm text-ink-700">
                Publish what you can provide, or register to help with deliveries.
              </p>
            </div>
            <LinkButton href="/offer" size="lg" variant="secondary">
              Offer supplies or volunteer
            </LinkButton>
          </Card>
        </div>
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-ink-900">Already asked for help?</h2>
        <p className="mt-1 text-sm text-ink-700">
          Open the private tracking link you were given to see the real status, add information, or
          confirm what arrived. The link is the only way in — your reference code on its own does
          not open your request, so nobody can look it up by guessing.
        </p>
      </Card>

      <FictionalNotice />
    </div>
  );
}
