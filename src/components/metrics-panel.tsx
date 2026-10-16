'use client';
import { useEffect, useState } from 'react';
import { api } from './actions';
import { Notice } from './ui';
export function MetricsPanel({ employerId }: { employerId?: string }) {
  const [data, setData] = useState<{
    events?: { event: string; count: number }[];
    applications?: { kind: string; status: string; count: number }[];
    revenue?: { currency: string; total: number }[];
    notes?: string;
  } | null>(null);
  const [jobs, setJobs] = useState<
    { id: string; title: string; applications: number; externalClicks: number; views: number }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(employerId ? `employers/${employerId}/metrics` : 'admin/metrics')
      .then((result) => {
        if (!active) return;
        if (employerId) setJobs(result);
        else setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [employerId]);
  return (
    <section className="panel">
      <h2>Measure what actually happened.</h2>
      <p>
        Native submissions, self-tracked external activity and consented page views are separate
        measures. No synthetic conversions are included.
      </p>
      {error && <Notice error>{error}</Notice>}
      {employerId ? (
        <div>
          {jobs.map((j) => (
            <div className="workspace-row" key={j.id}>
              <h3>{j.title}</h3>
              <span>
                {j.applications} native submissions · {j.externalClicks} click-only tracked
                activities · {j.views} consented views
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <h3>Consented product events</h3>
          {data?.events?.map((e) => (
            <p key={e.event}>
              {e.event}: {e.count}
            </p>
          ))}
          <h3>Applications by actual status</h3>
          {data?.applications?.map((e) => (
            <p key={e.kind + e.status}>
              {e.kind} · {e.status}: {e.count}
            </p>
          ))}
          <h3>Settled revenue by currency</h3>
          {data?.revenue?.map((e) => (
            <p key={e.currency}>
              {e.currency} {(e.total / 100).toLocaleString()}
            </p>
          ))}
          <p>{data?.notes}</p>
        </>
      )}
    </section>
  );
}
