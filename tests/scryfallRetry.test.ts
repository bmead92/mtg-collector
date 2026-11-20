import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Scryfall rate limit', () => {
  it('waits and retries after a 429', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.push(Date.now());
        if (calls.length < 3) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
        return new Response(JSON.stringify({ data: [{ id: 'x' }], not_found: [] }), { status: 200 });
      }),
    );
    vi.resetModules();
    const { cardsByIdentifiers } = await import('../src/lib/scryfall');
    const pending = cardsByIdentifiers([{ id: 'x' }]);
    await vi.runAllTimersAsync();
    const { found } = await pending;
    expect(found.map((c) => c.id)).toEqual(['x']);
    expect(calls).toHaveLength(3);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1000);
  });
});
