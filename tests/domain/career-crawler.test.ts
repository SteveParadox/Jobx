import { describe, expect, it } from 'vitest';
import { isCandidatePath, locationsFromSitemap } from '../../src/domain/discovery/career-crawler';

describe('bounded career crawler parsers', () => {
  it('recognizes career and job paths without treating generic assets as job pages', () => {
    expect(isCandidatePath(new URL('https://example.com/careers'))).toBe(true);
    expect(isCandidatePath(new URL('https://example.com/openings/engineering'))).toBe(true);
    expect(isCandidatePath(new URL('https://example.com/assets/logo.svg'))).toBe(false);
  });

  it('extracts only same-host HTTPS sitemap locations', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/careers</loc></url>
        <url><loc>https://example.com/jobs/engineer</loc></url>
        <url><loc>https://attacker.example/jobs</loc></url>
        <url><loc>http://example.com/jobs/insecure</loc></url>
        <url><loc>https://user:pass@example.com/jobs/credentials</loc></url>
      </urlset>`;
    expect(locationsFromSitemap(xml, new URL('https://example.com/'))).toEqual([
      new URL('https://example.com/careers'),
      new URL('https://example.com/jobs/engineer'),
    ]);
  });
});
