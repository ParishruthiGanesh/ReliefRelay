import { categoryLabel, formatQuantity } from '@/lib/util/units';
import type { RequestDraft } from '@/lib/validation/schemas';
import { computeMissingFields } from '@/lib/domain/requests';

/**
 * The read-back. Everything spoken is also displayed, word for word.
 *
 * It states what was recorded and nothing more. In particular it never implies
 * that supplies are coming, and when a quantity is unknown it says so rather
 * than printing a number nobody gave.
 */
export interface Readback {
  /** Spoken and shown. */
  summary: string;
  /** Short lines for the confirmation panel. */
  lines: Array<{ label: string; value: string; caution?: boolean }>;
  /** What a coordinator will see as missing. */
  missingFields: string[];
  caveats: string[];
}

function describeItems(draft: RequestDraft): string {
  if (draft.items.length === 0) return 'supplies not yet specified';
  const parts = draft.items.map((item) => {
    const label = categoryLabel(item.categoryId).toLowerCase();
    if (item.quantity === null) return label;
    return `${formatQuantity(item.quantity, item.categoryId, item.quantityUncertain)}`;
  });
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function buildReadback(draft: RequestDraft): Readback {
  const missingFields = computeMissingFields(draft);
  const caveats: string[] = [];

  const items = describeItems(draft);
  const forWhom =
    draft.groupSize !== null
      ? ` for ${draft.groupSize} ${draft.groupSize === 1 ? 'person' : 'people'}`
      : '';
  const place = draft.locationText ? ` at ${draft.locationText}` : '';

  const opening =
    draft.intent === 'offer'
      ? `You are offering ${items}${place}.`
      : `Your request is for ${items}${forWhom}${place}.`;

  if (draft.items.some((i) => i.quantity === null || i.quantityUncertain)) {
    caveats.push('Supply quantities still need coordinator confirmation.');
  }
  if (draft.locationText && !draft.locationConfirmed) {
    caveats.push('The exact place has not been confirmed, so a coordinator will check it.');
  }
  if (draft.dangerReported) {
    caveats.push(
      'You reported immediate danger. Please contact emergency services by phone — this app cannot send rescuers and has not contacted anyone for you.',
    );
  }
  if (draft.skippedFields.length > 0) {
    caveats.push('Some questions were skipped; a coordinator will see what is missing.');
  }

  const summary = [opening, ...caveats, 'Shall I submit it?'].join(' ');

  const lines: Array<{ label: string; value: string; caution?: boolean }> = [];
  lines.push({
    label: draft.intent === 'offer' ? 'Offering' : 'Requesting',
    // Named per category, so an unknown amount reads as a fact about that
    // resource rather than as a repeated disclaimer.
    value: draft.items.length
      ? draft.items
          .map((i) =>
            i.quantity === null
              ? `${categoryLabel(i.categoryId)}: amount not yet known`
              : `${categoryLabel(i.categoryId)}: ${formatQuantity(i.quantity, i.categoryId, i.quantityUncertain)}`,
          )
          .join('\n')
      : 'not yet specified',
    caution: draft.items.some((i) => i.quantity === null),
  });
  if (draft.groupSize !== null) {
    lines.push({
      label: 'Group size',
      value: `${draft.groupSize} ${draft.groupSize === 1 ? 'person' : 'people'}${draft.groupSizeUncertain ? ' (approximate)' : ''}`,
    });
  }
  lines.push({
    label: 'Place',
    value: draft.locationText ?? 'not given',
    caution: !draft.locationConfirmed,
  });
  if (draft.urgency) lines.push({ label: 'Urgency as reported', value: draft.urgency });
  if (draft.contactMethod && draft.contactMethod !== 'none' && draft.contactValue) {
    lines.push({ label: 'Contact', value: `${draft.contactMethod}: ${draft.contactValue}` });
  }
  if (draft.behalfRole !== 'self') {
    lines.push({ label: 'Submitted by', value: draft.behalfRole.replace('_', ' ') });
  }

  return { summary, lines, missingFields, caveats };
}

/**
 * The message after a successful save. Deliberately flat: a reference code and
 * the true status. No "help is on the way".
 */
export function submissionConfirmation(referenceCode: string): string {
  return `Your request has been submitted. Your reference is ${referenceCode}. A coordinator has not yet accepted it.`;
}

export function offlineNotice(): string {
  return 'Saved on this device — not yet sent.';
}
