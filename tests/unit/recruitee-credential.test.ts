import { afterEach, describe, expect, it } from 'vitest';
import { createSourceContext, type Transport } from '../../src/integrations/sources/http';
import type { Source } from '../../src/integrations/sources/contracts';

const keyName = 'JOB_SOURCE_TOKEN_RECRUITEE_TEST';
const before = process.env[keyName];
afterEach(() => {
  if (before === undefined) delete process.env[keyName];
  else process.env[keyName] = before;
});
describe('authorized employer feed authentication', () => {
  it('supports the fixed Recruitee Careers token header without bearer leakage', async () => {
    process.env[keyName] = 'fixture-operator-token';
    const observed: Record<string, string>[] = [];
    const transport: Transport = async (url, options) => {
      observed.push(options.headers);
      return {
        url, status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: '{"offers":[]}',
      };
    };
    const endpoint = 'https://example.recruitee.com/api/offers/';
    const context = createSourceContext({
      approvedHostname: 'example.recruitee.com',
      endpointUrl: endpoint,
      config: {
        credentialEnv: keyName,
        credentialMode: 'recruitee_careers',
        robots: false,
      },
    } as unknown as Source, { transport });
    await context.request(endpoint, ['application/json']);
    expect(observed[0]['X-Careers-Sites-Token']).toBe('fixture-operator-token');
    expect(observed[0].Authorization).toBeUndefined();
  });
});
