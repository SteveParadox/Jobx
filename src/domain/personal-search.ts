import { getDb } from '@/db';
import { profiles } from '@/db/schema';
import type { Actor } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { searchJobs } from './search';

// This is a private, on-demand search of the *published* Jobx catalog.
// It is not a new crawler, importer, hiring-eligibility determination or AI assessment.
const inputSchema = z.object({
  q: z.string().trim().max(160).default(''),
  remoteOnly: z.enum(['true', 'false']).default('true'),
  includeUnconfirmed: z.enum(['true', 'false']).default('true'),
});
type CatalogJob = Awaited<ReturnType<typeof searchJobs>>['jobs'][number];
type GeographyJob = Pick<
  CatalogJob,
  'workplace' | 'country' | 'remoteEligibility' | 'remoteCountries'
>;

export type GeographyStatus =
  | 'advertised_match'
  | 'local_location'
  | 'needs_review'
  | 'relocation_possible'
  | 'advertised_exclusion';

export function assessAdvertisedGeography(job: GeographyJob, country: string | null): {
  status: GeographyStatus;
  label: string;
} {
  const home = country?.trim().toUpperCase() || null;
  if (job.workplace === 'remote') {
    if (job.remoteEligibility === 'worldwide')
      return {
        status: 'advertised_match',
        label: 'Advertised worldwide; confirm country and employment requirements',
      };
    if (job.remoteEligibility === 'restricted') {
      if (!home)
        return { status: 'needs_review', label: 'Country-specific remote role; check locations' };
      if (job.remoteCountries.some((v) => v.toUpperCase() === home))
        return {
          status: 'advertised_match',
          label: 'Advertised for your profile country; check full eligibility',
        };
      return {
        status: 'advertised_exclusion',
        label: 'Your profile country is not in the advertised remote locations',
      };
    }
    return { status: 'needs_review', label: 'Remote applicant countries not confirmed' };
  }
  if (job.workplace === 'onsite' || job.workplace === 'hybrid') {
    if (!home || !job.country)
      return { status: 'needs_review', label: 'Check location and work authorization' };
    if (job.country.toUpperCase() === home)
      return {
        status: 'local_location',
        label: 'Located in your profile country; work authorization not checked',
      };
    return {
      status: 'relocation_possible',
      label: 'Outside your profile country; relocation or sponsorship may be required',
    };
  }
  return { status: 'needs_review', label: 'Workplace and location eligibility not confirmed' };
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
function containsPhrase(haystack: string, phrase: string) {
  const value = normalize(phrase);
  if (!value) return false;
  const index = haystack.indexOf(value);
  if (index < 0) return false;
  // A bounded phrase avoids counting "Go" in "ongoing" or "Java" in "JavaScript".
  const before = index === 0 ? '' : haystack[index - 1];
  const after = haystack[index + value.length] ?? '';
  return (!before || !/[a-z0-9]/i.test(before)) && (!after || !/[a-z0-9]/i.test(after));
}

export function overlappingSkills(
  job: Pick<CatalogJob, 'skills' | 'title' | 'descriptionText'>,
  candidateSkills: string[],
) {
  const listed = new Set(job.skills.map(normalize));
  const title = normalize(job.title);
  const description = normalize(job.descriptionText.slice(0, 16000));
  return [...new Map(
    candidateSkills
      .map((skill) => [normalize(skill), skill.trim()] as const)
      .filter(([normalized]) => normalized.length > 0),
  ).values()].filter((skill) => {
    const normalized = normalize(skill);
    return (
      listed.has(normalized) ||
      containsPhrase(title, normalized) ||
      (normalized.length > 3 && containsPhrase(description, normalized))
    );
  });
}

export async function personalJobSearch(actor: Actor, input: unknown) {
  const options = inputSchema.parse(input);
  const [profile] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.userId, actor.id))
    .limit(1);
  const skills = (profile?.skills ?? []).map((v) => v.trim()).filter(Boolean);
  const country = profile?.country?.toUpperCase() ?? null;
  const terms = [...new Map(
    [options.q, ...skills, profile?.headline ?? '']
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .map((term) => [term.toLowerCase(), term] as const),
  ).values()].slice(0, 5);

  if (terms.length === 0)
    return {
      jobs: [],
      profileCountry: country,
      examined: 0,
      explanation: 'Add skills or a headline to your profile, or enter a role to search.',
    };

  // Each term uses the same visibility, source-approval and moderation gates as public search.
  // Five bounded searches can inspect up to 100 distinct published results, on demand only.
  const pages = await Promise.all(
    terms.map((q) =>
      searchJobs({
        q,
        page: 1,
        sort: 'relevance',
        ...(options.remoteOnly === 'true' ? { workplace: 'remote' } : {}),
      }),
    ),
  );
  const candidates = new Map<string, CatalogJob>();
  for (const page of pages)
    for (const job of page.jobs) candidates.set(job.id, job);

  const jobs = [...candidates.values()]
    .map((job) => {
      const geography = assessAdvertisedGeography(job, country);
      const matchedSkills = overlappingSkills(job, skills);
      const score =
        matchedSkills.length * 10 +
        (geography.status === 'advertised_match' || geography.status === 'local_location' ? 3 : 0) +
        (job.lastVerifiedAt && Date.now() - job.lastVerifiedAt.getTime() < 14 * 86400000 ? 1 : 0);
      return { job, geography, matchedSkills, score };
    })
    .filter(({ geography }) => {
      if (geography.status === 'advertised_exclusion') return false;
      if (options.includeUnconfirmed === 'true') return true;
      return geography.status === 'advertised_match' || geography.status === 'local_location';
    })
    .sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id))
    .slice(0, 20)
    .map(({ job, geography, matchedSkills }) => ({
      id: job.id,
      slug: job.slug,
      title: job.title,
      companyName: job.companyName,
      locationLabel: job.locationLabel,
      workplace: job.workplace,
      matchedSkills: matchedSkills.slice(0, 5),
      matchStrength: matchedSkills.length >= 2 ? 'multiple_skills' : matchedSkills.length ? 'one_skill' : 'keyword_only',
      geographyStatus: geography.status,
      geographyLabel: geography.label,
      lastVerifiedAt: job.lastVerifiedAt?.toISOString() ?? null,
    }));

  return {
    jobs,
    profileCountry: country,
    examined: candidates.size,
    explanation:
      'Results come only from the approved, published Jobx catalog. Skill overlap is a simple heuristic, not an AI score or prediction. Verify the employer page, vacancy and legal eligibility before applying.',
  };
}
