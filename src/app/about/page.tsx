import { chainStatus } from '@/lib/providers/chain';
import { envFeedStatus } from '@/lib/providers/envfeed';
import { extractionProviderStatus } from '@/lib/providers/extraction';
import { languageSupport } from '@/lib/providers/languages';
import { sttStatus } from '@/lib/providers/stt';
import { ttsStatus } from '@/lib/providers/tts';
import { Badge, Card, SectionHeading } from '@/components/ui';

export const metadata = { title: 'What is real here — ReliefRelay' };
export const dynamic = 'force-dynamic';

/**
 * The honesty page. It reads the running configuration rather than repeating
 * documentation, so it cannot drift out of date relative to what the server is
 * actually doing.
 */
export default async function AboutPage() {
  const extraction = extractionProviderStatus();
  const stt = sttStatus();
  const tts = ttsStatus();
  const feed = envFeedStatus();
  const chain = await chainStatus();
  const languages = languageSupport();

  const rows: Array<{
    capability: string;
    state: 'live' | 'local' | 'simulated';
    detail: string;
  }> = [
    {
      capability: 'Request submission, coordination, allocation, delivery and receipts',
      state: 'live',
      detail:
        'Fully implemented against a SQLite database with transactional allocation. This is the working core of the prototype.',
    },
    {
      capability: 'Conversational extraction',
      state: extraction.live ? 'live' : 'local',
      detail: extraction.note,
    },
    { capability: 'Speech to text', state: stt.live ? 'live' : 'local', detail: stt.note },
    { capability: 'Spoken replies', state: tts.live ? 'live' : 'local', detail: tts.note },
    {
      capability: 'Environmental advisories',
      state: feed.live ? 'live' : 'simulated',
      detail: feed.note,
    },
    {
      capability: 'Supply attestations on a blockchain',
      state: chain.enabled && chain.reachable ? 'local' : 'simulated',
      detail: chain.note,
    },
    {
      capability: 'District, facilities, organisations, people, advisories',
      state: 'simulated',
      detail:
        'Entirely fictional. The coordinates sit in open ocean so they cannot be mistaken for a real place, and every record is flagged as fictional in the database.',
    },
    {
      capability: 'SMS and messaging notifications',
      state: 'simulated',
      detail:
        'Not implemented. There is no SMS adapter, so the interface never shows "SMS sent" anywhere. It is a future adapter behind the same provider interface as the others.',
    },
    {
      capability: 'Flood forecasting',
      state: 'simulated',
      detail:
        'Not implemented and not claimed. ReliefRelay displays advisories published by a source. No model here predicts flooding, and no flood is attributed to a cause.',
    },
    {
      capability: 'Rescue dispatch',
      state: 'simulated',
      detail:
        'Deliberately absent. Reports of immediate danger interrupt the supply questions with guidance to call emergency services, are flagged for coordinator escalation, and are never described as notified.',
    },
  ];

  const TONE = { live: 'good', local: 'teal', simulated: 'simulated' } as const;
  const LABEL = {
    live: 'Live integration',
    local: 'Runs locally',
    simulated: 'Simulated or absent',
  } as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">What is real here</h1>
        <p className="mt-2 max-w-2xl text-ink-700">
          A prototype is only useful if you can tell which parts are doing real work. This page is
          generated from the server&rsquo;s running configuration.
        </p>
      </div>

      <Card>
        <SectionHeading>Capabilities</SectionHeading>
        <ul className="space-y-3">
          {rows.map((row) => (
            <li className="border-b border-sand-200 pb-3 last:border-b-0" key={row.capability}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[row.state]}>{LABEL[row.state]}</Badge>
                <span className="font-semibold text-ink-900">{row.capability}</span>
              </div>
              <p className="mt-1 text-sm text-ink-700">{row.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeading description="Listed with what has actually been verified, not with what the architecture could support.">
          Languages
        </SectionHeading>
        <ul className="space-y-3">
          {languages.map((language) => (
            <li className="border-b border-sand-200 pb-3 last:border-b-0" key={language.code}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink-900">{language.label}</span>
                <Badge tone={language.uiReady ? 'good' : 'neutral'}>
                  {language.uiReady ? 'Extraction written' : 'Extraction not written yet'}
                </Badge>
                <Badge tone={language.sttReady ? 'good' : 'neutral'}>
                  {language.sttReady ? 'Speech recognition configured' : 'No speech recognition'}
                </Badge>
                <Badge tone={language.ttsReady ? 'good' : 'neutral'}>
                  {language.ttsReady ? 'Spoken replies configured' : 'Browser voice only'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-700">{language.note}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionHeading>Privacy</SectionHeading>
        <ul className="space-y-2 text-sm text-ink-700">
          <li>
            <strong>Recordings.</strong>{' '}
            {process.env.RETAIN_SERVER_AUDIO === 'true'
              ? 'Server-side audio retention is enabled on this instance.'
              : 'Audio is held in memory for the length of the transcription call and then discarded. It is never written to disk and never written to a log.'}
          </li>
          <li>
            <strong>Transcripts.</strong> Kept in the operator database so a coordinator can read
            what someone actually said. Never published and never written on-chain.
          </li>
          <li>
            <strong>Exact locations and contact details.</strong> Coordinator views only. Public
            maps show points coarsened to roughly a one-kilometre grid.
          </li>
          <li>
            <strong>Private tracking links.</strong> Only a sha256 hash of each token is stored, so
            the database holds nothing that opens a request. The printable reference code is not
            accepted as a credential.
          </li>
          <li>
            <strong>On-chain records.</strong> An opaque organisation reference, an opaque request
            reference, and a sha256 hash of a quantity-level manifest. No names, no phone numbers,
            no coordinates, no medical information, no recordings, no transcripts.
          </li>
        </ul>
      </Card>

      <Card>
        <SectionHeading>What a blockchain record does and does not prove</SectionHeading>
        <p className="text-sm text-ink-700">
          An attestation preserves that an organisation made an acknowledgement at a point in time,
          and lets two organisations later agree that the acknowledgement has not been altered. It
          is not independent proof that goods changed hands, and it does not stop anyone
          acknowledging something untrue. It also cannot block relief work: acknowledgements are
          written to the database first and pushed to the chain afterwards, retrying on failure.
        </p>
      </Card>
    </div>
  );
}
