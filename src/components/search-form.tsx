'use client';
import { ArrowUpRight, MapPin, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
export function SearchForm({
  initialQuery = '',
  initialCountry = '',
  compact = false,
}: {
  initialQuery?: string;
  initialCountry?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<{ title: string }[]>([]);
  const [focus, setFocus] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const id = useId();
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/platform/suggestions?q=' + encodeURIComponent(query), {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok)
            throw new Error('Suggestions are unavailable. You can still submit your search.');
          return r.json();
        })
        .then((value) => {
          setSuggestions(value);
          setSuggestionError('');
        })
        .catch((error) => {
          if (error.name !== 'AbortError') setSuggestionError(error.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <form action="/jobs" className={'search-form ' + (compact ? 'compact' : '')} role="search">
      <div className="search-keyword">
        <Search size={20} aria-hidden="true" />
        <label className="sr-only" htmlFor={id + 'q'}>
          Job title, company or skill
        </label>
        <input
          id={id + 'q'}
          name="q"
          aria-describedby={suggestionError ? id + 'suggestion-error' : undefined}
          placeholder="Job title, company, or skill"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSuggestions([]);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          autoComplete="off"
          list={id + 'suggestions'}
        />
        <datalist id={id + 'suggestions'}>
          {focus && suggestions.map((s) => <option value={s.title} key={s.title} />)}
        </datalist>
        {suggestionError && (
          <small id={id + 'suggestion-error'} role="status">
            {suggestionError}
          </small>
        )}
      </div>
      <div className="search-location">
        <MapPin size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor={id + 'country'}>
          Country
        </label>
        <select id={id + 'country'} name="country" defaultValue={initialCountry}>
          <option value="">Anywhere</option>
          <option value="NG">Nigeria</option>
          <option value="GB">United Kingdom</option>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="DE">Germany</option>
          <option value="IN">India</option>
          <option value="ZA">South Africa</option>
          <option value="AU">Australia</option>
        </select>
      </div>
      <button className="button button-primary" type="submit">
        Find jobs <ArrowUpRight size={18} />
      </button>
    </form>
  );
}
