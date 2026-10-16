import { afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../../src/proxy';
afterEach(() => vi.unstubAllEnvs());
it('sets staging noindex at request time', () => {
  vi.stubEnv('APP_ENV', 'staging');
  expect(proxy(new NextRequest('http://localhost:3000')).headers.get('X-Robots-Tag')).toBe(
    'noindex, nofollow',
  );
});
it('does not bake staging noindex into production Docker responses', () => {
  vi.stubEnv('APP_ENV', 'production');
  const response = proxy(new NextRequest('https://careeratlas.example.com'));
  expect(response.headers.get('X-Robots-Tag')).toBeNull();
  expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
});
