'use client';
import type { SearchFilters } from '@/domain/validation';
import { useEffect, useState } from 'react';

export function SearchHistoryRecorder({ filters }: { filters: SearchFilters }) {
  const criteria = JSON.stringify(filters);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (JSON.parse(criteria).page !== 1) return;
    // The server checks authentication and explicit account opt-in. No browser identifier
    // or anonymous history is created, and failures never block public search.
    void fetch('/api/platform/search-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: criteria,
    })
      .then((response) => setError(!response.ok))
      .catch(() => setError(true));
  }, [criteria]);
  return error ? (
    <p className="container" role="status">
      Recent search history could not be updated. Your job results are still available.
    </p>
  ) : null;
}
