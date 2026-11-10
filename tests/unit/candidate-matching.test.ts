import { describe, expect, it } from 'vitest';
import { matchingCandidateSkills } from '../../src/domain/candidates';
describe('opt-in candidate matching primitives', () => {
  it('matches exact job skills or bounded title phrases without substring false matches', () => {
    expect(matchingCandidateSkills({
      title: 'JavaScript Engineer and Go Developer',
      skills: ['TypeScript', 'PostgreSQL'],
    }, ['Java', 'Go', 'TypeScript', 'go', 'PostgreSQL'])).toEqual([
      'Go', 'TypeScript', 'PostgreSQL',
    ]);
  });
  it('does not imply applicant eligibility from skills', () => {
    expect(matchingCandidateSkills({
      title: 'Remote Nurse', skills: ['First aid'],
    }, ['First aid'])).toEqual(['First aid']);
  });
});
