import { json } from '@/lib/api/http';
import { chainStatus } from '@/lib/providers/chain';
import { envFeedStatus } from '@/lib/providers/envfeed';
import { extractionProviderStatus } from '@/lib/providers/extraction';
import { languageSupport } from '@/lib/providers/languages';
import { sttStatus } from '@/lib/providers/stt';
import { ttsStatus } from '@/lib/providers/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What is live, what is local, and what is simulated — reported from the
 * running configuration rather than from documentation, so the answer cannot
 * drift away from reality.
 */
export async function GET() {
  return json({
    extraction: extractionProviderStatus(),
    stt: sttStatus(),
    tts: ttsStatus(),
    environmentalFeed: envFeedStatus(),
    chain: await chainStatus(),
    languages: languageSupport(),
    data: {
      district: 'Riverbend District',
      isFictional: true,
      note: 'Every district, facility, organisation, person and advisory in this prototype is fictional.',
    },
    emergency: {
      number: process.env.EMERGENCY_NUMBER ?? '112',
      label: process.env.EMERGENCY_LABEL ?? 'Local emergency services (configure for your region)',
      note: 'ReliefRelay does not contact emergency services and never claims to have done so.',
    },
    privacy: {
      serverAudioRetained: process.env.RETAIN_SERVER_AUDIO === 'true',
      note: 'Recordings are discarded immediately after transcription unless retention is explicitly enabled. Transcripts stay in the operator database and are never written on-chain.',
    },
  });
}
