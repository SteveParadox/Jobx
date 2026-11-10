import { describe, expect, it, vi } from 'vitest';
import { endpoint } from '../../src/lib/http';

describe('API endpoint error diagnostics', () => {
  it('reports the original unexpected exception without exposing it in the response', async () => {
    const failure = new TypeError('private internal diagnostic');
    const inspect = vi.fn();

    const response = await endpoint(async () => {
      throw failure;
    }, inspect);

    expect(response.status).toBe(500);
    expect(inspect).toHaveBeenCalledExactlyOnceWith(failure);
    expect(JSON.stringify(await response.json())).not.toContain('private internal diagnostic');
  });

  it('does not leak or override a 500 when diagnostic output itself fails', async () => {
    const response = await endpoint(
      async () => {
        throw new TypeError('internal diagnostic');
      },
      () => {
        throw new Error('debug logger failed');
      },
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('debug logger failed');
  });
});
