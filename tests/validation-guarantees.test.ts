import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { proposedUpdateSchema, loginSchema, requestDraftSchema, emptyDraft, sttRequestSchema } from '@/lib/validation/schemas';

describe('zod 4 keeps the guarantees this app relies on', () => {
  it('.strict() still rejects unknown keys — the model boundary', () => {
    const ok = proposedUpdateSchema.safeParse({ groupSize: 25 });
    expect(ok.success).toBe(true);

    for (const forbidden of [
      { groupSize: 25, requestStatus: 'fulfilled' },
      { markDelivered: true },
      { inventoryQty: 999 },
      { groupSize: 25, __proto__: { polluted: true }, extra: 1 },
    ]) {
      const bad = proposedUpdateSchema.safeParse(forbidden);
      expect(bad.success, `should reject ${JSON.stringify(forbidden)}`).toBe(false);
    }
  });

  it('nested item objects are strict too', () => {
    const bad = proposedUpdateSchema.safeParse({
      items: [{ categoryId: 'meal_packs', quantity: 10, sneaky: 'value' }],
    });
    expect(bad.success).toBe(false);
  });

  it('.default() still fills draft fields', () => {
    const draft = emptyDraft();
    expect(draft.items).toEqual([]);
    expect(draft.locationConfirmed).toBe(false);
    expect(draft.groupSize).toBeNull();
    expect(draft.language).toBe('en');
    expect(draft.behalfRole).toBe('self');
  });

  it('numeric and string constraints still bite', () => {
    expect(proposedUpdateSchema.safeParse({ groupSize: -1 }).success).toBe(false);
    expect(proposedUpdateSchema.safeParse({ groupSize: 1.5 }).success).toBe(false);
    expect(proposedUpdateSchema.safeParse({ groupSize: 10 ** 9 }).success).toBe(false);
    expect(proposedUpdateSchema.safeParse({ notes: Array(50).fill('x') }).success).toBe(false);
    expect(requestDraftSchema.safeParse({ ...emptyDraft(), items: Array(20).fill({ categoryId: 'meal_packs', quantity: 1, unit: 'packs', quantityUncertain: false }) }).success).toBe(false);
  });

  it('email validation still works', () => {
    expect(loginSchema.safeParse({ email: 'coordinator@reliefrelay.test', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });

  it('enums still reject unknown members', () => {
    expect(proposedUpdateSchema.safeParse({ urgency: 'apocalyptic' }).success).toBe(false);
    expect(proposedUpdateSchema.safeParse({ items: [{ categoryId: 'gold_bars' }] }).success).toBe(false);
    expect(proposedUpdateSchema.safeParse({ urgency: 'critical' }).success).toBe(true);
  });

  it('error.flatten() still produces the shape the API returns', () => {
    const bad = loginSchema.safeParse({ email: 'nope', password: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const flat = bad.error.flatten();
      expect(flat).toHaveProperty('fieldErrors');
      expect(typeof JSON.stringify(flat)).toBe('string');
    }
  });

  it('the audio size ceiling is still enforced by the schema as well', () => {
    const tooBig = { language: 'en', audioBase64: 'A'.repeat(20_000_001), mimeType: 'audio/webm' };
    expect(sttRequestSchema.safeParse(tooBig).success).toBe(false);
  });
});
