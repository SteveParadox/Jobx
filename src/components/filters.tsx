'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
export function Filters() {
  const params = useSearchParams();
  const v = (name: string) => params.get(name) ?? '';
  const content = (
    <form action="/jobs" className="filter-form">
      <input type="hidden" name="q" value={v('q')} />
      <h2>Refine your search</h2>
      <label>
        Country code
        <input
          name="country"
          defaultValue={v('country')}
          placeholder="e.g. NG, GB, US"
          maxLength={2}
          pattern="[A-Z]{2}"
        />
      </label>
      <label>
        State or region
        <input name="region" defaultValue={v('region')} />
      </label>
      <label>
        City
        <input name="city" defaultValue={v('city')} />
      </label>
      <label>
        Workplace
        <select name="workplace" defaultValue={v('workplace')}>
          <option value="">Any workplace</option>
          {['remote', 'hybrid', 'onsite'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Remote eligibility
        <input
          name="eligibleCountry"
          defaultValue={v('eligibleCountry')}
          placeholder="Applicant country code"
          maxLength={2}
          pattern="[A-Z]{2}"
        />
      </label>
      <label>
        Employment type
        <select name="employmentType" defaultValue={v('employmentType')}>
          <option value="">Any employment</option>
          {[
            'FULL_TIME',
            'PART_TIME',
            'CONTRACTOR',
            'TEMPORARY',
            'INTERN',
            'VOLUNTEER',
            'PER_DIEM',
            'OTHER',
          ].map((x) => (
            <option key={x} value={x}>
              {x.toLowerCase().replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seniority
        <input name="seniority" defaultValue={v('seniority')} />
      </label>
      <label>
        Job category
        <input name="category" defaultValue={v('category')} />
      </label>
      <label>
        Industry
        <input name="industry" defaultValue={v('industry')} />
      </label>
      <details>
        <summary>Salary & additional filters</summary>
        <label>
          Minimum disclosed salary
          <input type="number" min="0" name="salaryMin" defaultValue={v('salaryMin')} />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue={v('currency')}>
            <option value="">Not selected</option>
            {['USD', 'NGN', 'GBP', 'EUR', 'CAD', 'AUD', 'INR', 'ZAR'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Salary period
          <select name="salaryPeriod" defaultValue={v('salaryPeriod')}>
            <option value="">Not selected</option>
            {['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <small>Salary filters and salary sorting require matching currency and period.</small>
        <label>
          Experience ceiling (years)
          <input
            name="experienceMax"
            type="number"
            min="0"
            max="60"
            defaultValue={v('experienceMax')}
          />
        </label>
        <label>
          Education
          <input name="education" defaultValue={v('education')} />
        </label>
        <label>
          Visa sponsorship
          <select name="visa" defaultValue={v('visa')}>
            <option value="">Any / unknown</option>
            <option value="true">Explicitly offered</option>
            <option value="false">Explicitly unavailable</option>
          </select>
        </label>
        <label>
          Company identifier
          <input name="company" defaultValue={v('company')} />
        </label>
      </details>
      <label>
        Posted within
        <select name="days" defaultValue={v('days')}>
          <option value="">Any time</option>
          <option value="1">24 hours</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </select>
      </label>
      <label>
        Sort by
        <select name="sort" defaultValue={v('sort') || 'relevance'}>
          <option value="relevance">Relevance</option>
          <option value="recent">Most recent</option>
          <option value="salary">Salary, same currency and period</option>
        </select>
      </label>
      <button className="button button-primary">Apply filters</button>
      <Link className="button button-ghost" href="/jobs">
        Clear all
      </Link>
    </form>
  );
  return (
    <>
      <aside className="desktop-filters">{content}</aside>
      <Dialog.Root>
        <Dialog.Trigger className="button button-secondary mobile-filter-trigger">
          <SlidersHorizontal size={16} /> Filters & sort
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="sr-only">Search filters</Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose criteria and apply to update your results.
            </Dialog.Description>
            <Dialog.Close className="dialog-close" aria-label="Close filters">
              <X />
            </Dialog.Close>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
