'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api } from './actions';
import { Button, Empty, Notice } from './ui';

type ProviderId = 'jobx' | 'himalayas' | 'adzuna' | 'usajobs' | 'jooble';
type Lead = {
  id: string;
  provider: ProviderId;
  providerName: string;
  title: string;
  company: string;
  location: string;
  url: string;
  excerpt: string;
  postedAt: string | null;
  provenance: 'published_catalog' | 'external_api';
  attributionUrl: string | null;
  attributionLogoUrl: string | null;
};
type SearchResult = {
  items: Lead[];
  providers: {
    provider: ProviderId;
    state: 'ok' | 'not_configured' | 'skipped' | 'error';
    count: number;
    note: string;
  }[];
  checkedAt: string;
  explanation: string;
};

export function FederatedSearch() {
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [market, setMarket] = useState('');
  const [provider, setProvider] = useState('all');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  async function searchPage(nextPage: number) {
    setResult(null);
    setError('');
    setBusy(true);
    const params = new URLSearchParams({
      q: q.trim(),
      location: location.trim(),
      provider,
      remoteOnly: String(remoteOnly),
      page: String(nextPage),
      ...(market ? { market } : {}),
    });
    try {
      setResult(await api('federated-search?' + params.toString()));
      setPage(nextPage);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchPage(1);
  }

  return (
    <div className="container page-container">
      <div className="page-header" style={{ padding: '24px 0 28px' }}>
        <div className="eyebrow">MULTI-SOURCE DISCOVERY</div>
        <h1>Search beyond a single job board.</h1>
        <p>
          Browse the approved Jobx catalog alongside job API partners enabled by the operator.
          No profile, industry, country, or remote-work assumption is applied automatically.
        </p>
      </div>
      <section className="panel">
        <form className="stack" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Job title, company or keywords
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setResult(null); setPage(1); }}
                required
                minLength={2}
                maxLength={120}
                placeholder="Nurse, warehouse, accountant, developer…"
              />
            </label>
            <label>
              External API location (optional)
              <input
                value={location}
                onChange={(e) => { setLocation(e.target.value); setResult(null); setPage(1); }}
                maxLength={120}
                placeholder="London, Nairobi, New York…"
              />
            </label>
            <label>
              Provider
              <select value={provider} onChange={(e) => { setProvider(e.target.value); setResult(null); setPage(1); }}>
                <option value="all">All configured providers</option>
                <option value="jobx">Jobx approved listings</option>
                <option value="himalayas">Himalayas (public remote-jobs API)</option>
                <option value="adzuna">Adzuna</option>
                <option value="usajobs">USAJOBS</option>
                <option value="jooble">Jooble</option>
              </select>
            </label>
            <label>
              National API market (optional)
              <select value={market} onChange={(e) => { setMarket(e.target.value); setResult(null); setPage(1); }}>
                <option value="">All operator-configured markets</option>
                <option value="ng">Nigeria</option>
                <option value="us">United States</option>
                <option value="gb">United Kingdom</option>
                <option value="ca">Canada</option>
                <option value="au">Australia</option>
                <option value="de">Germany</option>
                <option value="fr">France</option>
                <option value="in">India</option>
                <option value="za">South Africa</option>
                <option value="br">Brazil</option>
                <option value="mx">Mexico</option>
                <option value="nz">New Zealand</option>
                <option value="sg">Singapore</option>
              </select>
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => { setRemoteOnly(e.target.checked); setResult(null); setPage(1); }}
            />
            Remote-only (providers without a confirmed remote filter will be skipped)
          </label>
          <div className="row-actions">
            <Button disabled={busy}>{busy ? 'Searching sources…' : 'Search configured sources'}</Button>
            <Link className="button button-secondary" href="/jobs">
              Browse the public Jobx catalog
            </Link>
          </div>
        </form>
        <p style={{ marginTop: 16 }}>
          Sign in is required to protect provider quotas. The location field applies to
          external API providers; use the structured filters on
          the public Jobx catalog page for catalog locations. Live partner APIs require separately
          configured credentials and display rights. Some providers support only certain markets. Results are not guaranteed
          open or eligible; check the original vacancy before applying.
        </p>
        {error && (
          <div style={{ marginTop: 12 }}>
            <Notice error>{error}</Notice>
            <Link href="/auth">Sign in to use multi-provider search</Link>
          </div>
        )}
      </section>
      {result && (
        <div className="stack" style={{ marginTop: 24 }}>
          <section className="panel">
            <h2>Source coverage</h2>
            <p>{result.explanation}</p>
            <small>Search executed {new Date(result.checkedAt).toLocaleString()}.</small>
            {result.providers.map((source) => (
              <div className="workspace-row" key={source.provider}>
                <div>
                  <strong>{source.provider === 'jobx' ? 'Jobx catalog' : source.provider.toUpperCase()}</strong>
                  <p>{source.note}</p>
                </div>
                <span className="pill">
                  {source.state.replaceAll('_', ' ')}
                  {source.state === 'ok' ? ' · ' + source.count : ''}
                </span>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>{result.items.length} result{result.items.length === 1 ? '' : 's'} from available sources</h2>
            <div className="row-actions">
              <small>Provider search page {page}. Each source has its own result ordering.</small>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || page <= 1}
                onClick={() => { void searchPage(page - 1); }}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || page >= 20 || result.items.length === 0}
                onClick={() => { void searchPage(page + 1); }}
              >
                Next page
              </Button>
            </div>
            {result.items.length === 0 ? (
              <Empty title="No results returned">
                Broaden the query, select another provider, or configure the supported APIs.
                An empty result here does not imply there are no jobs elsewhere.
              </Empty>
            ) : (
              result.items.map((item) => (
                <article className="workspace-row" key={item.provider + ':' + item.id}>
                  <div>
                    <h3>
                      <a
                        href={item.url}
                        {...(item.provenance === 'external_api'
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {item.title}
                      </a>
                    </h3>
                    <p>{item.company} · {item.location}</p>
                    <small>Source: {item.providerName}</small>
                    {item.excerpt && <p>{item.excerpt}</p>}
                    <small>
                      {item.provenance === 'published_catalog'
                        ? 'Approved Jobx listing'
                        : 'External API lead; not independently verified by Jobx'}
                      {item.postedAt ? ' · Reported ' + new Date(item.postedAt).toLocaleDateString() : ''}
                    </small>
                    {item.provider === 'adzuna' && item.attributionLogoUrl && item.attributionUrl && (
                      <div style={{ marginTop: 8, minHeight: 24 }}>
                        <a href={item.attributionUrl} target="_blank" rel="noopener noreferrer">
                          Jobs by
                        </a>{' '}
                        <a href={item.attributionUrl} target="_blank" rel="noopener noreferrer">
                          {/* Use the official Adzuna image configured by the operator. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.attributionLogoUrl}
                            width={116}
                            height={23}
                            style={{ minWidth: 116, minHeight: 23, verticalAlign: 'middle' }}
                            alt="Adzuna"
                          />
                        </a>
                      </div>
                    )}
                    {item.provider === 'himalayas' && item.attributionUrl && (
                      <p>
                        <a href={item.attributionUrl} target="_blank" rel="noopener noreferrer">
                          Remote jobs sourced from Himalayas
                        </a>
                      </p>
                    )}
                    {item.provider === 'jooble' && item.attributionUrl && (
                      <p><a href={item.attributionUrl} target="_blank" rel="noopener noreferrer">Jobs powered by Jooble</a></p>
                    )}
                  </div>
                  <a
                    className="text-link"
                    href={item.url}
                    {...(item.provenance === 'external_api'
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {item.provenance === 'published_catalog' ? 'View job →' : 'Review at provider →'}
                  </a>
                </article>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
