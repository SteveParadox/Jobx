import type { SearchFilters } from './validation';

// History represents search criteria, independently of paging and presentation order.
export function historyFilters(filters: SearchFilters) {
  const { page: _page, sort: _sort, ...criteria } = filters;
  void _page;
  void _sort;
  return Object.fromEntries(
    Object.entries(criteria)
      .filter(([, value]) => value !== undefined && value !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function searchHref(filters: unknown) {
  const query = new URLSearchParams();
  if (filters && typeof filters === 'object')
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  return '/jobs' + (query.size ? '?' + query.toString() : '');
}

export function searchSummary(filters: unknown) {
  if (!filters || typeof filters !== 'object') return 'All opportunities';
  const data = filters as Record<string, unknown>;
  return (
    [data.q, data.workplace, data.city, data.region, data.country, data.category]
      .filter(Boolean)
      .map(String)
      .join(' · ') || 'Filtered opportunities'
  );
}
