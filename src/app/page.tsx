import { JobCard } from '@/components/job-card';
import { SearchForm } from '@/components/search-form';
import { Empty } from '@/components/ui';
import { inventory, searchJobs } from '@/domain/search';
import { metadata } from '@/domain/seo';
import { brand, env } from '@/lib/config';
import { jsonLd } from '@/lib/security';
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Code2,
  Compass,
  Globe2,
  PenTool,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const generateMetadata = () =>
  metadata(
    'Find your next direction',
    'Search genuine vacancies across countries, explore remote work and apply directly with employers.',
    '/',
  );
export default async function Home() {
  const connected = Boolean(env.DATABASE_URL);
  const [result, categories] = connected
    ? await Promise.all([searchJobs({ sort: 'recent' }), inventory()])
    : [{ jobs: [], total: 0 }, []];
  const icons = [Code2, BriefcaseBusiness, PenTool, ChartNoAxesCombined];
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-top">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="tiny-line" />
                YOUR NEXT CHAPTER STARTS HERE
              </div>
              <h1>
                Good work.
                <br />A world of <em>possibility.</em>
              </h1>
              <p>
                Find opportunities that move you forward.
                <br className="desktop-break" /> Across borders, beyond the ordinary.
              </p>
            </div>
            <aside className="hero-aside">
              <div className="orbit" aria-hidden="true">
                <Compass size={105} strokeWidth={0.7} />
                <span className="orbit-dot" />
              </div>
              <div className="hero-aside-copy">
                <span className="tag tag-light">A clearer way forward</span>
                <h2>
                  Local ambition.
                  <br />
                  Global horizons.
                </h2>
                <p>
                  Explore opportunities on your terms.
                  <br />
                  Know the source. Choose your direction.
                </p>
                <Link href="/remote-jobs">
                  Explore remote work <ArrowUpRight size={17} />
                </Link>
              </div>
            </aside>
          </div>
          <SearchForm />
          <div className="hero-bottom">
            <span>Explore your way:</span>
            <Link href="/remote-jobs">
              Remote opportunities <ArrowUpRight size={13} />
            </Link>
            <Link href="/jobs?country=NG">
              Jobs in Nigeria <ArrowUpRight size={13} />
            </Link>
            <Link href="/jobs?employmentType=INTERN">
              Internships <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <div className="container">
          <span>
            <Globe2 size={17} />A global view of work
          </span>
          <span>
            <ShieldCheck size={17} />
            Transparent sources & application links
          </span>
          <span>
            <Compass size={17} />
            Free for job seekers, always
          </span>
        </div>
      </div>
      <section className="section container">
        <div className="section-heading">
          <div className="eyebrow">FIND YOUR FOCUS</div>
          <h2>Where will you go next?</h2>
          <p>Explore fields with opportunities currently in our catalog.</p>
        </div>
        {categories.length ? (
          <div className="category-grid">
            {categories
              .filter((x) => x.category)
              .map((c, i) => {
                const Icon = icons[i % icons.length];
                return (
                  <Link
                    key={c.category}
                    href={'/jobs?category=' + encodeURIComponent(c.category!)}
                    className="category-card"
                  >
                    <Icon size={24} strokeWidth={1.4} />
                    <h3>{c.category}</h3>
                    <span>
                      {c.count} active {c.count === 1 ? 'opportunity' : 'opportunities'}
                      <ArrowUpRight size={17} />
                    </span>
                  </Link>
                );
              })}
          </div>
        ) : (
          <div className="browse-paths">
            <Link href="/jobs">
              <BriefcaseBusiness />
              Browse all opportunities
              <ArrowUpRight />
            </Link>
            <Link href="/remote-jobs">
              <Globe2 />
              Work beyond borders
              <ArrowUpRight />
            </Link>
          </div>
        )}
      </section>
      <section className="section section-tinted">
        <div className="container">
          <div className="section-row">
            <div>
              <div className="eyebrow">YOUR NEXT MOVE</div>
              <h2>New possibilities, real openings.</h2>
            </div>
            <Link className="text-link" href="/jobs">
              View all jobs <ArrowRight size={17} />
            </Link>
          </div>
          {result.jobs.length ? (
            <div className="job-list">
              {result.jobs.slice(0, 5).map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <Empty
              title={
                connected ? 'Our next openings are on their way' : 'The catalog is being connected'
              }
            >
              We publish listings after employer or source review. Check back for active roles, or
              create an account to set up a job alert.
            </Empty>
          )}
          <div className="small-callout">
            <BellIcon />
            <div>
              <strong>The right role. Straight to your inbox.</strong>
              <span>Create an alert for the work and places that matter to you.</span>
            </div>
            <Link className="button button-secondary" href="/dashboard">
              Set up an alert <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section container">
        <div className="section-row">
          <div>
            <div className="eyebrow">MORE THAN A JOB SEARCH</div>
            <h2>Move forward with confidence.</h2>
          </div>
          <Link className="text-link" href="/resources">
            Career resources <ArrowRight size={17} />
          </Link>
        </div>
        <div className="resource-grid">
          {[
            {
              n: '01',
              tag: 'THE APPLICATION',
              title: 'Make your experience easy to understand.',
              text: 'Practical guidance for a clear, honest résumé that helps employers see your fit.',
              url: '/resources/resume-guide',
            },
            {
              n: '02',
              tag: 'THE CONVERSATION',
              title: 'Go into your interview prepared.',
              text: 'Turn the job description into questions, evidence and a thoughtful conversation.',
              url: '/resources/interview-preparation',
            },
            {
              n: '03',
              tag: 'THE REMOTE SEARCH',
              title: 'Find remote work that works for you.',
              text: 'Understand location eligibility, working hours and the signals of a legitimate role.',
              url: '/resources/remote-work',
            },
          ].map((r) => (
            <Link href={r.url} key={r.n} className="resource-card">
              <div className="resource-top">
                <span>{r.tag}</span>
                <span>{r.n}</span>
              </div>
              <h3>{r.title}</h3>
              <p>{r.text}</p>
              <ArrowUpRight size={23} />
            </Link>
          ))}
        </div>
      </section>
      <section className="container employer-banner">
        <div>
          <div className="eyebrow">FOR TEAMS BUILDING WHAT’S NEXT</div>
          <h2>
            Great work starts
            <br />
            with the right people.
          </h2>
          <p>
            Give your next opening a clear home. Reach candidates
            <br className="desktop-break" /> with transparent listings and a simpler hiring
            workspace.
          </p>
        </div>
        <div>
          <Link href="/employers" className="button button-cream">
            Start hiring <ArrowUpRight size={18} />
          </Link>
          <Link href="/pricing">Explore employer plans →</Link>
        </div>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: brand.name,
            url: brand.url,
          }),
        }}
      />
    </>
  );
}
function BellIcon() {
  return (
    <span className="callout-icon" aria-hidden="true">
      ↗
    </span>
  );
}
