/**
 * Immediate-danger detection.
 *
 * When someone says they are in danger of drowning, trapped, or badly hurt,
 * the routine supply questions stop and brief guidance to contact local
 * emergency services is shown instead. The app does NOT dispatch anyone, and
 * it never says responders have been notified, because nothing here notifies
 * them. The request is still recorded and flagged so a coordinator can
 * escalate it to the established responders.
 */

import { t } from '@/lib/i18n/messages';

const DANGER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(drown|drowning|going under)\b/i, label: 'drowning' },
  { re: /\b(trapped|stuck)\b.*\b(roof|attic|upstairs|car|house|inside)\b/i, label: 'trapped' },
  { re: /\bon the roof\b/i, label: 'on a roof' },
  { re: /\b(can'?t breathe|cannot breathe|not breathing)\b/i, label: 'breathing difficulty' },
  { re: /\b(unconscious|collapsed|not responding)\b/i, label: 'unconscious person' },
  { re: /\b(bleeding|badly (hurt|injured)|serious(ly)? injured|broken leg|broken arm)\b/i, label: 'serious injury' },
  { re: /\b(need|needs) rescue\b/i, label: 'rescue requested' },
  { re: /\brescue (us|me|them|him|her)\b/i, label: 'rescue requested' },
  { re: /\b(water is rising|rising fast|rising very fast|up to (my|our) (chest|neck|waist))\b/i, label: 'water rising around people' },
  { re: /\b(swept away|washed away)\b/i, label: 'person swept away' },
  { re: /\b(dying|about to die|life[- ]threatening)\b/i, label: 'life-threatening situation' },
  { re: /\b(baby|child|children|elderly|disabled)\b.*\b(trapped|stranded|cut off)\b/i, label: 'vulnerable people cut off' },
];

export interface DangerSignal {
  detected: boolean;
  labels: string[];
  excerpt: string | null;
}

export function detectDanger(text: string): DangerSignal {
  const labels: string[] = [];
  for (const { re, label } of DANGER_PATTERNS) {
    if (re.test(text) && !labels.includes(label)) labels.push(label);
  }
  return {
    detected: labels.length > 0,
    labels,
    excerpt: labels.length > 0 ? text.slice(0, 400) : null,
  };
}

export interface EmergencyGuidance {
  headline: string;
  body: string;
  emergencyNumber: string;
  emergencyLabel: string;
  /** Deliberately false everywhere: this prototype notifies nobody. */
  respondersNotified: false;
}

export function emergencyGuidance(labels: string[], language = 'en'): EmergencyGuidance {
  const what = labels.length > 0 ? labels.join(', ') : t(language, 'danger.generic');
  return {
    headline: t(language, 'danger.headline'),
    body: t(language, 'danger.body', { what }),
    emergencyNumber: process.env.EMERGENCY_NUMBER ?? '112',
    emergencyLabel:
      process.env.EMERGENCY_LABEL ?? 'Local emergency services (configure for your region)',
    respondersNotified: false,
  };
}
