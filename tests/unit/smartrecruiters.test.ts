import { describe, expect, it } from 'vitest';
import { smartRecruitersAdapter } from '../../src/integrations/sources/smartrecruiters';
import { detectAts } from '../../src/domain/discovery/source-classifier';
import type { SourceContext, SourceResponse } from '../../src/integrations/sources/contracts';

function sourceContext(totalFound = 1, maxPages = 2) {
  let calls = 0;
  const records = [{
    id: '42', name: 'Medical Laboratory Scientist',
    location: { country: 'NG', city: 'Lagos', remote: true },
  }];
  const detail = {
    id: '42', name: 'Medical Laboratory Scientist', active: true,
    applyUrl: 'https://jobs.smartrecruiters.com/example/42',
    releasedDate: '2026-11-01T00:00:00Z',
    location: { country: 'NG', city: 'Lagos', remote: true },
    jobAd: { sections: {
      jobDescription: { text: 'Join a medical diagnostics team performing clinical laboratory tests and reviewing validated reports for medical decisions.' },
      qualifications: { text: 'Laboratory science qualification with relevant diagnostic experience and strong attention to detail.' },
    } },
  };
  const request = async (url: string): Promise<SourceResponse> => {
    calls++;
    return {
      url, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
      body: url.includes('/postings/') ? JSON.stringify(detail) : JSON.stringify({
        content: records,
        totalFound,
      }),
    };
  };
  const context = {
    source: { boardToken: 'example', endpointUrl: 'https://api.smartrecruiters.com/v1/companies/example/postings' },
    config: { maxRequests: 20, maxPages, pageSize: 10 },
    request,
    checkCancelled: async () => {},
    requestCount: () => calls,
  } as unknown as SourceContext;
  return { context, requests: () => calls };
}
describe('SmartRecruiters approved ATS source', () => {
  it('recognizes employer board URLs without granting permission', () => {
    expect(detectAts('https://jobs.smartrecruiters.com/example/42')).toEqual({
      provider: 'smartrecruiters', boardToken: 'example',
    });
    expect(detectAts('https://evil.example/jobs')).toBeNull();
  });
  it('retrieves complete public job details and leaves remote eligibility unknown', async () => {
    const { context, requests } = sourceContext();
    const snapshot = await smartRecruitersAdapter.fetch(context);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].data).toMatchObject({
      title: 'Medical Laboratory Scientist',
      workplace: 'remote',
      remoteEligibility: 'unknown',
    });
    expect(requests()).toBe(2);
  });
  it('does not declare an incomplete API page a full source snapshot', async () => {
    const { context } = sourceContext(100, 1);
    await expect(smartRecruitersAdapter.fetch(context)).rejects.toThrow('complete snapshot');
  });
});
