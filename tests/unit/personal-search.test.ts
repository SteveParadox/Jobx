import { describe, expect, it } from 'vitest';
import { assessAdvertisedGeography, overlappingSkills } from '../../src/domain/personal-search';

const remote = {
  workplace: 'remote',
  country: null,
  remoteEligibility: 'restricted',
  remoteCountries: ['US', 'CA'],
};
describe('personal search matching rules', () => {
  it('never treats an explicitly excluded country as eligible', () => {
    expect(assessAdvertisedGeography(remote, 'NG').status).toBe('advertised_exclusion');
    expect(assessAdvertisedGeography(remote, 'US').status).toBe('advertised_match');
    expect(assessAdvertisedGeography(remote, null).status).toBe('needs_review');
  });
  it('does not turn an unknown remote label into worldwide eligibility', () => {
    expect(
      assessAdvertisedGeography({ ...remote, remoteEligibility: 'unknown', remoteCountries: [] }, 'NG')
        .status,
    ).toBe('needs_review');
    expect(
      assessAdvertisedGeography({ ...remote, remoteEligibility: 'worldwide', remoteCountries: [] }, 'NG')
        .status,
    ).toBe('advertised_match');
  });
  it('distinguishes local job location from right to work', () => {
    expect(
      assessAdvertisedGeography({
        workplace: 'onsite', country: 'NG', remoteEligibility: 'unknown', remoteCountries: [],
      }, 'NG').status,
    ).toBe('local_location');
    expect(
      assessAdvertisedGeography({
        workplace: 'onsite', country: 'GB', remoteEligibility: 'unknown', remoteCountries: [],
      }, 'NG').status,
    ).toBe('relocation_possible');
  });
  it('matches listed skills and bounded title phrases, not substrings', () => {
    const job = {
      skills: ['TypeScript'],
      title: 'Java Engineer',
      descriptionText: 'Responsible for ongoing delivery and testing.',
    };
    expect(overlappingSkills(job, ['typescript', 'Java', 'Go', 'script'])).toEqual([
      'typescript',
      'Java',
    ]);
  });
  it('ignores descriptions for short ambiguous skills', () => {
    expect(overlappingSkills({
      skills: [], title: 'Software Engineer', descriptionText: 'We go beyond expectations.',
    }, ['Go'])).toEqual([]);
  });
});
