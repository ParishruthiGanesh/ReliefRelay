import type { ExtractionProvider } from '../types';
import { AnthropicExtractionProvider } from './anthropic';
import { RulesExtractionProvider } from './rules';

/**
 * Picks the extraction provider from the environment.
 *
 * Default is the deterministic extractor, so a checkout with an empty .env is
 * fully usable. Asking for `anthropic` without a key is a configuration
 * mistake worth surfacing, not something to paper over silently — the label
 * reported to the UI says exactly what ran.
 */
export function getExtractionProvider(): ExtractionProvider {
  const configured = (process.env.EXTRACTION_PROVIDER ?? 'rules').toLowerCase();
  const key = process.env.ANTHROPIC_API_KEY;

  if (configured === 'anthropic') {
    if (!key) {
      return new RulesExtractionProvider();
    }
    return new AnthropicExtractionProvider(key);
  }
  return new RulesExtractionProvider();
}

export function extractionProviderStatus(): {
  configured: string;
  active: string;
  live: boolean;
  note: string;
} {
  const configured = (process.env.EXTRACTION_PROVIDER ?? 'rules').toLowerCase();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (configured === 'anthropic' && hasKey) {
    return {
      configured,
      active: 'anthropic',
      live: true,
      note: `Claude (${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'}) proposes structured fields; the backend validates and saves them.`,
    };
  }
  if (configured === 'anthropic' && !hasKey) {
    return {
      configured,
      active: 'rules',
      live: false,
      note: 'EXTRACTION_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set, so the deterministic extractor is running.',
    };
  }
  return {
    configured: 'rules',
    active: 'rules',
    live: false,
    note: 'Deterministic rule-based extraction running on this server. No AI service is called. Set EXTRACTION_PROVIDER=anthropic and ANTHROPIC_API_KEY to use Claude.',
  };
}

export { RulesExtractionProvider } from './rules';
export { AnthropicExtractionProvider } from './anthropic';
