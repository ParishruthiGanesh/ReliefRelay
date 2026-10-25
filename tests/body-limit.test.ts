import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readBody } from '@/lib/api/http';

/**
 * Oversized bodies are refused before anything parses them.
 *
 * Schema limits such as `.max(8)` on an array are checked after the payload
 * has already been parsed into memory, so they cannot defend a public endpoint
 * against a very large body. This guard runs first, which is what makes the
 * defence independent of the validator's own behaviour.
 */
const schema = z.object({ items: z.array(z.string()).max(8) });

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('request body size limit', () => {
  it('accepts an ordinary body', async () => {
    const result = await readBody(makeRequest(JSON.stringify({ items: ['a', 'b'] })), schema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items).toEqual(['a', 'b']);
  });

  it('refuses an oversized body with 413, without parsing it', async () => {
    // Half a megabyte of array entries: well inside what JSON.parse would
    // happily build, and far past what any endpoint here needs.
    const huge = JSON.stringify({ items: Array.from({ length: 40_000 }, () => 'xxxxxxxxxx') });
    expect(huge.length).toBeGreaterThan(256 * 1024);

    const result = await readBody(makeRequest(huge), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = (await result.response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('body_too_large');
      expect(body.error.message).toMatch(/too large/i);
    }
  });

  it('refuses a body that lies about its content-length', async () => {
    const huge = JSON.stringify({ items: Array.from({ length: 40_000 }, () => 'xxxxxxxxxx') });
    // A declared length under the limit must not get the real body through.
    const result = await readBody(makeRequest(huge, { 'content-length': '10' }), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('lets the audio endpoint send a large body under its own limit', async () => {
    const audioSchema = z.object({ audioBase64: z.string() });
    // 1 MB: refused by the default cap, allowed by the audio one.
    const payload = JSON.stringify({ audioBase64: 'A'.repeat(1_000_000) });

    const refused = await readBody(makeRequest(payload), audioSchema);
    expect(refused.ok).toBe(false);

    const allowed = await readBody(makeRequest(payload), audioSchema, {
      maxBytes: 28 * 1024 * 1024,
    });
    expect(allowed.ok).toBe(true);
  });

  it('still reports invalid JSON and invalid fields normally', async () => {
    const bad = await readBody(makeRequest('{not json'), schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response.status).toBe(400);

    const wrong = await readBody(makeRequest(JSON.stringify({ items: 'nope' })), schema);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.response.status).toBe(422);
  });
});
