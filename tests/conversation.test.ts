import { describe, expect, it } from 'vitest';
import {
  confirmAndSubmit,
  selectLocation,
  startConversation,
  submitTurn,
  viewConversation,
} from '@/lib/conversation/engine';
import { getRequestByTrackingToken, getRequestItems } from '@/lib/domain/requests';
import { freshDb } from './helpers';

describe('the voice conversation from the brief', () => {
  it('runs the scripted dialogue and submits with an honest status', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });

    // Turn 1: the opening report.
    let view = await submitTurn(db, started.conversationId, {
      text: 'We are at the school near the old bridge. There are twenty-five people here. We need food and drinking water.',
      inputMode: 'voice',
      sttProvider: 'browser-webspeech',
    });

    // Both resources recorded, the group size recorded as PEOPLE, and no
    // quantity invented from it.
    expect(view.draft.items.map((i) => i.categoryId).sort()).toEqual([
      'drinking_water',
      'meal_packs',
    ]);
    expect(view.draft.groupSize).toBe(25);
    expect(view.draft.items.every((i) => i.quantity === null)).toBe(true);

    // "the school near the old bridge" matched more than one place, so the
    // assistant asks rather than guessing coordinates.
    expect(view.question?.field).toBe('location_choice');
    expect(view.draft.locationConfirmed).toBe(false);
    expect(view.draft.locationCandidates.length).toBeGreaterThan(1);
    expect(view.assistantText).toMatch(/recorded/i);

    // Turn 2: they name the school.
    view = await submitTurn(db, started.conversationId, {
      text: 'Riverside Primary School',
      inputMode: 'voice',
    });
    expect(view.draft.locationConfirmed).toBe(true);
    expect(view.draft.resolvedFacilityId).toBe('fac_riverside_primary');

    // Turn 3: the scope question, answered yes.
    expect(view.question?.field).toBe('group_scope');
    expect(view.question?.text).toContain('25');
    view = await submitTurn(db, started.conversationId, { text: 'Yes', inputMode: 'voice' });

    // Read-back, with the honest caveat about quantities.
    expect(view.state).toBe('confirming');
    expect(view.readback?.summary).toContain('Riverside Primary School');
    expect(view.readback?.summary).toContain('25 people');
    expect(view.readback?.summary).toMatch(/quantities still need coordinator confirmation/i);
    expect(view.readback?.summary).toMatch(/shall i submit it/i);

    // Three questions at most before the read-back.
    expect(view.questionCount).toBeLessThanOrEqual(3);

    const result = confirmAndSubmit(db, started.conversationId, {
      idempotencyKey: 'test-key-abcdef12',
      confirmedSummary: view.readback!.summary,
      acceptIncomplete: true,
    });

    expect(result.referenceCode).toMatch(/^RR-\d{4}$/);
    expect(result.status).toBe('submitted');
    expect(result.assistantText).toBe(
      `Your request has been submitted. Your reference is ${result.referenceCode}. A coordinator has not yet accepted it.`,
    );
    // Crucially: nothing that implies anyone is coming.
    expect(result.assistantText).not.toMatch(/on the way|help is coming|dispatched/i);

    const items = getRequestItems(db, result.requestId);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.quantity === null)).toBe(true);
    expect(items.every((i) => i.quantity_uncertain === 1)).toBe(true);

    const byToken = getRequestByTrackingToken(db, result.trackingToken);
    expect(byToken?.id).toBe(result.requestId);
    expect(byToken?.group_size).toBe(25);
  });

  it('applies a spoken correction without touching supply quantities', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    await submitTurn(db, started.conversationId, {
      text: 'We need 60 meal packs for 25 people at Northfield College Gymnasium.',
      inputMode: 'voice',
    });

    let view = viewConversation(db, started.conversationId);
    expect(view.draft.groupSize).toBe(25);
    expect(view.draft.items.find((i) => i.categoryId === 'meal_packs')?.quantity).toBe(60);

    view = await submitTurn(db, started.conversationId, {
      text: 'Actually, there are 35 people.',
      inputMode: 'voice',
    });
    expect(view.draft.groupSize).toBe(35);
    // The meal-pack figure the user gave is untouched by the correction.
    expect(view.draft.items.find((i) => i.categoryId === 'meal_packs')?.quantity).toBe(60);
  });

  it('never converts an unrecognised unit into litres', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    const view = await submitTurn(db, started.conversationId, {
      text: 'We need 50 bottles of water at Old Bridge Community Hall.',
      inputMode: 'voice',
    });
    const water = view.draft.items.find((i) => i.categoryId === 'drinking_water');
    expect(water).toBeDefined();
    expect(water?.quantity).toBeNull();
    expect(water?.quantityUncertain).toBe(true);
    expect(water?.note).toMatch(/50 bottles/);
    expect(water?.unit).toBe('litres');
  });

  it('distinguishes an offer from a request', async () => {
    const db = freshDb();
    const needConv = startConversation(db, { language: 'en', mode: 'request' });
    const need = await submitTurn(db, needConv.conversationId, {
      text: 'We need 50 meal packs at Riverside Primary School.',
      inputMode: 'text',
    });
    expect(need.draft.intent).toBe('need');

    const offerConv = startConversation(db, { language: 'en', mode: 'request' });
    const offer = await submitTurn(db, offerConv.conversationId, {
      text: 'We can provide 50 meal packs from Southgate Supply Hub.',
      inputMode: 'text',
    });
    expect(offer.draft.intent).toBe('offer');
  });

  it('interrupts with emergency guidance and promises no notification', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    const view = await submitTurn(db, started.conversationId, {
      text: 'The water is rising fast and my neighbour is trapped on the roof. We also need drinking water.',
      inputMode: 'voice',
    });
    expect(view.draft.dangerReported).toBe(true);
    expect(view.emergency).not.toBeNull();
    expect(view.emergency?.respondersNotified).toBe(false);
    expect(view.assistantText).toMatch(/emergency services/i);
    expect(view.assistantText).toMatch(/has not contacted anyone/i);
    expect(view.assistantText).not.toMatch(/responders have been notified|help is on the way/i);
  });

  it('lets a user skip a question and still submit, with the gap visible', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    await submitTurn(db, started.conversationId, {
      text: 'We need hygiene kits at Riverside Primary School.',
      inputMode: 'text',
    });
    const view = await submitTurn(db, started.conversationId, {
      text: "I don't know",
      inputMode: 'text',
    });
    expect(view.draft.skippedFields.length).toBeGreaterThan(0);

    const ready = view.state === 'confirming' ? view : viewConversation(db, started.conversationId);
    const result = confirmAndSubmit(db, started.conversationId, {
      idempotencyKey: 'skip-key-abcdef12',
      confirmedSummary: ready.readback?.summary ?? 'hygiene kits at Riverside Primary School',
      acceptIncomplete: true,
    });
    expect(result.missingFields.some((f) => f.startsWith('quantity:'))).toBe(true);
  });

  it('returns the same request when an offline client retries a submission', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    await submitTurn(db, started.conversationId, {
      text: 'We need 20 hygiene kits at Riverside Primary School.',
      inputMode: 'text',
    });
    const view = viewConversation(db, started.conversationId);
    const payload = {
      idempotencyKey: 'retry-key-abcdef12',
      confirmedSummary: view.readback?.summary ?? 'summary',
      acceptIncomplete: true,
    };
    const first = confirmAndSubmit(db, started.conversationId, payload);
    const second = confirmAndSubmit(db, started.conversationId, payload);
    expect(second.requestId).toBe(first.requestId);
    expect(second.deduplicated).toBe(true);
    const count = db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('keeps the draft on the server across a reload', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    await submitTurn(db, started.conversationId, {
      text: 'We need food for 12 people at Old Bridge Community Hall.',
      inputMode: 'voice',
    });
    // A fresh read, as a reloaded browser would do.
    const reloaded = viewConversation(db, started.conversationId);
    expect(reloaded.draft.groupSize).toBe(12);
    expect(reloaded.draft.items.map((i) => i.categoryId)).toContain('meal_packs');
  });

  it('lets the user pick a location explicitly from the offered candidates', async () => {
    const db = freshDb();
    const started = startConversation(db, { language: 'en', mode: 'request' });
    const view = await submitTurn(db, started.conversationId, {
      text: 'We need drinking water. We are at the school near the old bridge.',
      inputMode: 'voice',
    });
    expect(view.draft.locationConfirmed).toBe(false);
    const after = selectLocation(db, started.conversationId, {
      facilityId: 'fac_old_bridge_hall',
    });
    expect(after.draft.locationConfirmed).toBe(true);
    expect(after.draft.resolvedFacilityId).toBe('fac_old_bridge_hall');
    expect(after.draft.locationText).toContain('Old Bridge');
  });
});
